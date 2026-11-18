import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { sameStudioDishReviewSubject, studioDishReviewKey, studioDishReviewSubject, type StudioDishSafetyFence, type StudioDishSafetyStatus } from "../../shared/hospitality-menu-studio-safety";
import type { Dish, Menu, Publication, PublicationScope, Review } from "./contract";
import { draftContentReview, menuDishIds } from "./review";
import { dateSchema, dishSchema, idSchema, menuSchema, revisionSchema, scopeSchema } from "./schema";
import { hasPublicationScope, type ScopedPublicationContent } from "./scoped-publication";
import { compareMenuDrafts } from "./versions";

export type PublicationRequest = { menuId: string; version: number; effectiveDate: string; scope: PublicationScope };
export type DishSafety = { status: StudioDishSafetyStatus; fence?: StudioDishSafetyFence };
export type SeasonWindow = { menuId: string; startDate: string; endDate: string };
export type PublicationImpactTarget = { firstEventDate: string; lastEventDate: string; catalogueItemIds: string[];
  scope: ScopedPublicationContent["impactScope"]; rotation?: ScopedPublicationContent["rotation"] };
export type PublicationPackage = {
  contract: "hospitality-menu-studio.publication.v1";
  publicationId: string;
  publicationRevision: number;
  sourceApp: "hospitality-menu-studio";
  projectId: "demo-fika-os";
  menu: Menu;
  effectiveDate: string;
  sourceDraftVersion: number;
  previousPublicationId: string | null;
  scope?: PublicationScope;
  catalogueHash: string;
  dishes: { dish: Dish; safety: Pick<StudioDishSafetyFence, "subject" | "releaseId" | "matrixHash"> }[];
};

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const packageSchema = z.object({
  contract: z.literal("hospitality-menu-studio.publication.v1"), publicationId: idSchema, publicationRevision: revisionSchema,
  sourceApp: z.literal("hospitality-menu-studio"), projectId: z.literal("demo-fika-os"), menu: menuSchema.strict(),
  effectiveDate: dateSchema, sourceDraftVersion: revisionSchema, previousPublicationId: idSchema.nullable(), catalogueHash: hash, scope: scopeSchema.optional(),
  dishes: z.array(z.object({ dish: dishSchema.strict(), safety: z.object({
    subject: z.object({ dishId: idSchema, revision: revisionSchema, sourceHash: hash }).strict(),
    releaseId: z.string().regex(/^cpu-studio-dish-release:[a-f0-9]{64}:v[1-9][0-9]*$/), matrixHash: hash,
  }).strict() }).strict()),
}).strict() satisfies z.ZodType<PublicationPackage>;

// Local authoring runs in one server process. Restarting requires a fresh review for unconfirmed requests.
const reviewKey = randomBytes(32);
const maxPackageBytes = 650_000;

export function reviewPublication(input: {
  request: PublicationRequest; menu: Menu; dishes: Dish[]; today: string; actorId: string; canPublish: boolean;
  catalogue?: CatalogueLoadResult; safety: Map<string, DishSafety>; previous?: Publication; previousPackage?: PublicationPackage;
  seasons: SeasonWindow[]; impact: Review["impact"]; scopeResult: Pick<ScopedPublicationContent, "issues" | "changes">;
}) {
  const { request, menu, dishes, today, catalogue, previous, previousPackage, impact, actorId } = input;
  const previousMenu = previousPackage?.menu;
  const { issues, changes } = draftContentReview(menu, dishes, request.effectiveDate, {}, today);
  issues.push(...input.scopeResult.issues);
  if (previous && request.effectiveDate < previous.effectiveDate) issues.push("Choose an effective date on or after the latest publication.");
  if (previousMenu && (previousMenu.kind !== menu.kind || previousMenu.startDate !== menu.startDate || previousMenu.endDate !== menu.endDate)) {
    issues.push("Keep the published menu type and date window. Create a different menu for a new date window.");
  }
  if (menu.kind === "seasonal" && input.seasons.some(season => season.menuId !== menu.id && season.startDate <= menu.endDate && season.endDate >= menu.startDate)) {
    issues.push("This seasonal date window overlaps an existing company menu.");
  }
  if (!catalogue || catalogue.source === "cache-unverified" || !/^[a-f0-9]{64}$/.test(catalogue.contentHash)) {
    issues.push("The current Hospitality catalogue could not be verified.");
  } else {
    const itemIds = new Set(catalogue.catalogue.items.map(item => item.id));
    for (const section of menu.sections) {
      if (section.catalogueItemId && !itemIds.has(section.catalogueItemId)) issues.push(`${section.name || "Unnamed section"} has no current Hub catalogue item.`);
    }
  }
  const dishIds = menuDishIds(menu);
  const states = dishIds.map(id => input.safety.get(id));
  const safety: Review["safety"] = { status: states.some(state => state?.status === "unavailable") ? "unavailable"
    : states.length && states.every(state => state?.status === "verified" && state.fence) ? "verified" : "unverified" };
  if (safety.status !== "verified") issues.push("Every dish revision requires current signed allergen verification.");
  if (!input.canPublish) issues.push("Your account does not have publication access.");
  const dishRevisions = new Map(previousPackage?.dishes.map(({ dish }) => [dish.id, dish.version]));
  const dishChanges = previousPackage ? dishes.filter(dish => dishRevisions.get(dish.id) !== dish.version).map(dish => `${dish.name} uses dish revision ${dish.version}.`) : [];
  const impactWarning = impact.status === "available" && impact.coverage === "partial" ? ["The impact check covered only part of the affected booking data. Additional bookings may be affected."] : [];
  const menuChanges = previousMenu ? [...compareMenuDrafts(previousMenu, menu), ...dishChanges] : changes;
  const review: Review = { canPublish: issues.length === 0, issues: [...issues, ...impactWarning], changes: [...menuChanges, ...input.scopeResult.changes],
    safety, impact, reviewToken: null };
  // Booking impact is advisory. An unavailable result stays in the author’s reviewed evidence and is preserved with publication.
  if (!review.canPublish || !catalogue) return { review };
  const byId = new Map(dishes.map(dish => [dish.id, dish]));
  const publicationRevision = (previous?.revision ?? 0) + 1;
  const payload: PublicationPackage = {
    contract: "hospitality-menu-studio.publication.v1", publicationId: publicationIdFor(menu.id, publicationRevision), publicationRevision,
    sourceApp: "hospitality-menu-studio", projectId: "demo-fika-os", menu, effectiveDate: request.effectiveDate, sourceDraftVersion: menu.version,
    previousPublicationId: previous?.id ?? null, catalogueHash: catalogue.contentHash,
    ...(hasPublicationScope(request.scope) ? { scope: request.scope } : {}),
    dishes: dishIds.map(id => {
      const { subject, releaseId, matrixHash } = input.safety.get(id)!.fence!;
      return { dish: byId.get(id)!, safety: { subject, releaseId, matrixHash } };
    }),
  };
  const body = canonicalJson(payload);
  const contentHash = publicationHash(body);
  if (Buffer.byteLength(body) > maxPackageBytes) return {
    review: { ...review, canPublish: false, issues: ["The full publication exceeds the storage limit."] },
  };
  const reviewToken = createHmac("sha256", reviewKey).update(canonicalJson(["studio-publication-review-v1", actorId, contentHash, impact])).digest("hex");
  return { review: { ...review, reviewToken }, package: { payload, body, contentHash } };
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function publicationImpactScope(request: PublicationRequest, content: ScopedPublicationContent): PublicationImpactTarget {
  return { firstEventDate: request.effectiveDate, lastEventDate: content.menu.endDate, catalogueItemIds: content.impactItemIds,
    scope: content.impactScope, ...(content.rotation ? { rotation: content.rotation } : {}) };
}

export function publicationHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function sameReviewToken(supplied: string, issued: string | null) {
  return issued !== null && hash.safeParse(supplied).success && timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(issued, "hex"));
}

export function decodeLocalPublicationPackage(body: string, publication: Publication): PublicationPackage | undefined {
  if (Buffer.byteLength(body) > maxPackageBytes || publicationHash(body) !== publication.contentHash) return undefined;
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { return undefined; }
  const parsed = packageSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== body) return undefined;
  const payload = parsed.data;
  if (payload.publicationId !== publication.id || payload.publicationRevision !== publication.revision
    || payload.publicationId !== publicationIdFor(payload.menu.id, payload.publicationRevision)
    || payload.previousPublicationId !== (payload.publicationRevision === 1 ? null : publicationIdFor(payload.menu.id, payload.publicationRevision - 1))
    || canonicalJson(payload.scope || {}) !== canonicalJson(publication.scope)
    || (payload.scope && (!hasPublicationScope(payload.scope) || payload.publicationRevision === 1))
    || payload.effectiveDate !== publication.effectiveDate || payload.menu.id !== publication.menuId || payload.menu.name !== publication.menuName
    || payload.sourceDraftVersion !== publication.sourceDraftVersion || payload.menu.version !== payload.sourceDraftVersion) return undefined;
  const dishIds = menuDishIds(payload.menu);
  if (dishIds.length !== payload.dishes.length || payload.dishes.some(({ dish, safety }, index) => {
    const subject = studioDishReviewSubject(dish);
    return dish.id !== dishIds[index] || dish.version < 1 || !sameStudioDishReviewSubject(safety.subject, subject)
      || !safety.releaseId.startsWith(`cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v`);
  })) return undefined;
  return payload;
}

function publicationIdFor(menuId: string, revision: number) { return `publication-${publicationHash(menuId).slice(0, 32)}-v${revision}`; }
