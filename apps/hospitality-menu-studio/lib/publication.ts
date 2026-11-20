import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canonicalJson, decodeStudioPublication, maximumStudioPublicationBytes, publicationDigest, publicationHash, publicationIdFor,
  type PublicationPackage,
} from "../../shared/hospitality-menu-studio-publication";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import type { StudioDishSafetyFence, StudioDishSafetyStatus } from "../../shared/hospitality-menu-studio-safety";
import type { Dish, Menu, Publication, PublicationScope, Review } from "./contract";
import { draftContentReview, menuDishIds } from "./review";
import { hasPublicationScope, type ScopedPublicationContent } from "./scoped-publication";
import { compareMenuDrafts } from "./versions";

export type PublicationRequest = { menuId: string; version: number; effectiveDate: string; scope: PublicationScope };
export type DishSafety = { status: StudioDishSafetyStatus; fence?: StudioDishSafetyFence };
export type SeasonWindow = { menuId: string; startDate: string; endDate: string };
export type PublicationImpactTarget = { firstEventDate: string; lastEventDate: string; catalogueItemIds: string[];
  scope: ScopedPublicationContent["impactScope"]; rotation?: ScopedPublicationContent["rotation"] };
export { canonicalJson, publicationHash, type PublicationPackage };

// Local authoring runs in one server process. Restarting requires a fresh review for unconfirmed requests.
const reviewKey = randomBytes(32);

export function reviewPublication(input: {
  request: PublicationRequest; menu: Menu; dishes: Dish[]; today: string; actorId: string; canPublish: boolean;
  catalogue?: CatalogueLoadResult; safety: Map<string, DishSafety>; previous?: Publication; previousPackage?: PublicationPackage;
  seasons: SeasonWindow[]; impact: Review["impact"]; scopeResult: Pick<ScopedPublicationContent, "issues" | "changes">;
  projectId?: PublicationPackage["projectId"]; reviewSigningKey?: string;
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
  const previousDishes = new Map(previousPackage?.dishes.map(item => [item.dish.id, item]));
  const dishChanges = previousPackage ? dishes.flatMap(dish => {
    const previousDish = previousDishes.get(dish.id);
    if (!previousDish || previousDish.dish.version !== dish.version) return [`${dish.name} uses dish revision ${dish.version}.`];
    const fence = input.safety.get(dish.id)?.fence;
    return fence && (fence.releaseId !== previousDish.safety.releaseId || fence.matrixHash !== previousDish.safety.matrixHash)
      ? [`${dish.name} uses a new signed food-safety review.`]
      : [];
  }) : [];
  const impactWarning = impact.status === "available" && impact.coverage === "partial" ? ["The impact check covered only part of the affected booking data. Additional bookings may be affected."] : [];
  const menuChanges = previousMenu ? [...compareMenuDrafts(previousMenu, menu), ...dishChanges] : changes;
  if (previousMenu && hasPublicationScope(request.scope) && !menuChanges.length && !issues.length) {
    issues.push("No published changes in this scope. Change the draft or choose a different scope.");
  }
  const review: Review = { canPublish: issues.length === 0, issues: [...issues, ...impactWarning], changes: [...menuChanges, ...input.scopeResult.changes],
    safety, impact, reviewToken: null };
  // Booking impact is advisory. An unavailable result stays in the author’s reviewed evidence and is preserved with publication.
  if (!review.canPublish || !catalogue) return { review };
  const byId = new Map(dishes.map(dish => [dish.id, dish]));
  const publicationRevision = (previous?.revision ?? 0) + 1;
  const payload: PublicationPackage = {
    contract: "hospitality-menu-studio.publication.v1", publicationId: publicationIdFor(menu.id, publicationRevision), publicationRevision,
    sourceApp: "hospitality-menu-studio", projectId: input.projectId ?? "demo-fika-os", menu, effectiveDate: request.effectiveDate, sourceDraftVersion: menu.version,
    previousPublicationId: previous?.id ?? null, catalogueHash: catalogue.contentHash,
    ...(hasPublicationScope(request.scope) ? { scope: request.scope } : {}),
    dishes: dishIds.map(id => {
      const { subject, releaseId, matrixHash } = input.safety.get(id)!.fence!;
      return { dish: byId.get(id)!, safety: { subject, releaseId, matrixHash } };
    }),
  };
  const body = canonicalJson(payload);
  const contentHash = publicationHash(body);
  if (Buffer.byteLength(body) > maximumStudioPublicationBytes) return {
    review: { ...review, canPublish: false, issues: ["The full publication exceeds the storage limit."] },
  };
  const reviewToken = createHmac("sha256", input.reviewSigningKey ?? reviewKey).update(canonicalJson(["studio-publication-review-v1", actorId, contentHash, impact])).digest("hex");
  return { review: { ...review, reviewToken }, package: { payload, body, contentHash } };
}

export function publicationImpactScope(request: PublicationRequest, content: ScopedPublicationContent): PublicationImpactTarget {
  return { firstEventDate: request.effectiveDate, lastEventDate: content.menu.endDate, catalogueItemIds: content.impactItemIds,
    scope: content.impactScope, ...(content.rotation ? { rotation: content.rotation } : {}) };
}

export function sameReviewToken(supplied: string, issued: string | null) {
  return issued !== null && publicationDigest.safeParse(supplied).success && timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(issued, "hex"));
}

export function decodeLocalPublicationPackage(body: string, publication: Publication): PublicationPackage | undefined {
  return decodeStudioPublication(body, publication, "demo-fika-os");
}
