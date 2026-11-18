import { createHash } from "node:crypto";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import type { StudioDishSafetyFence, StudioDishSafetyStatus } from "../../shared/hospitality-menu-studio-safety";
import type { Dish, Menu, Publication, PublicationScope, Review } from "./contract";
import { draftContentReview, menuDishIds } from "./review";
import { compareMenuDrafts } from "./versions";

export type PublicationRequest = { menuId: string; version: number; effectiveDate: string; scope: PublicationScope };
export type DishSafety = { status: StudioDishSafetyStatus; fence?: StudioDishSafetyFence };
export type SeasonWindow = { menuId: string; startDate: string; endDate: string };
export type PublicationImpactTarget = { firstEventDate: string; lastEventDate: string; catalogueItemIds: string[]; scope: "catalogue-item" };
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
  catalogueHash: string;
  dishes: { dish: Dish; safety: Pick<StudioDishSafetyFence, "subject" | "releaseId" | "matrixHash"> }[];
};

export function reviewPublication(input: {
  request: PublicationRequest; menu: Menu; dishes: Dish[]; today: string; actorId: string; canPublish: boolean;
  catalogue?: CatalogueLoadResult; safety: Map<string, DishSafety>; previous?: Publication; previousPackage?: PublicationPackage;
  seasons: SeasonWindow[]; impact: Review["impact"];
}) {
  const { request, menu, dishes, today, catalogue, previous, previousPackage, impact, actorId } = input;
  const previousMenu = previousPackage?.menu;
  const { issues, changes } = draftContentReview(menu, dishes, request.effectiveDate, request.scope, today);
  if (request.scope.sectionId || request.scope.week || request.scope.dishId) issues.push("Select the whole menu for this publication.");
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
  const review: Review = { canPublish: issues.length === 0, issues: [...issues, ...impactWarning], changes: previousMenu ? [...compareMenuDrafts(previousMenu, menu), ...dishChanges] : changes,
    safety, impact, reviewToken: null };
  // Booking impact is advisory. An unavailable result stays in the author’s reviewed evidence and is preserved with publication.
  if (!review.canPublish || !catalogue) return { review };
  const byId = new Map(dishes.map(dish => [dish.id, dish]));
  const publicationRevision = (previous?.revision ?? 0) + 1;
  const payload: PublicationPackage = {
    contract: "hospitality-menu-studio.publication.v1", publicationId: `publication-${publicationHash(menu.id).slice(0, 32)}-v${publicationRevision}`, publicationRevision,
    sourceApp: "hospitality-menu-studio", projectId: "demo-fika-os", menu, effectiveDate: request.effectiveDate, sourceDraftVersion: menu.version,
    previousPublicationId: previous?.id ?? null, catalogueHash: catalogue.contentHash,
    dishes: dishIds.map(id => {
      const { subject, releaseId, matrixHash } = input.safety.get(id)!.fence!;
      return { dish: byId.get(id)!, safety: { subject, releaseId, matrixHash } };
    }),
  };
  const body = canonicalJson(payload);
  const contentHash = publicationHash(body);
  if (Buffer.byteLength(body) > 650_000) return {
    review: { ...review, canPublish: false, issues: ["The full publication exceeds the storage limit."] },
  };
  const reviewToken = publicationHash(canonicalJson(["studio-publication-review-v1", actorId, contentHash, impact]));
  return { review: { ...review, reviewToken }, package: { payload, body, contentHash } };
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function publicationImpactScope(request: PublicationRequest, menu: Menu, previous?: PublicationPackage): PublicationImpactTarget {
  const sections = [...menu.sections, ...(previous?.menu.sections || [])];
  return { firstEventDate: request.effectiveDate, lastEventDate: menu.endDate,
    catalogueItemIds: [...new Set(sections.map(section => section.catalogueItemId).filter(Boolean))].sort(), scope: "catalogue-item" };
}

export function publicationHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
