import { CANONICAL_MENU_SLOTS, canonicalMenuSlotIdFor } from "../../shared/menu-section-order";

/** New weeks use the versioned canonical 29-slot order. */
export const ROLLING_SLOTS = CANONICAL_MENU_SLOTS.map(item => item.id) as readonly string[];
/** Old drafts keep their three historical permanent rows; new templates include Dessert 4. */
export const PERMANENT_DESSERT_SLOTS = ["DESSERT 1", "DESSERT 2", "DESSERT 3"] as const;
const NEVER_REMOVABLE_DESSERT_SLOTS = [...PERMANENT_DESSERT_SLOTS, "DESSERT 4"] as const;
/** Slots found in older saved weeks remain readable and retain their historical ordering. */
export const LEGACY_ROLLING_SLOTS = ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6", "COLD PROTEIN", "SOUP", "HOT MEAT", "VEGAN MAIN", "HOT VEG VEGAN", "EXTRAS 1", "EXTRAS 2", "EXTRAS 3", "EXTRAS 4", "EXTRAS 5", "EXTRAS 6"] as const;
/**
 * Seed the canonical row contract into new weeks. Permanent template additions
 * that are legacy aliases of canonical rows remain stored and continue to render
 * in already-created weeks, but are not duplicated in newly-created weeks.
 */
export function newWeekTemplateSlots(templateAdditions: readonly string[] = []) {
  const canonicalIds = new Set(ROLLING_SLOTS);
  const additions = templateAdditions.filter(slot => {
    const canonicalId = canonicalMenuSlotIdFor(slot);
    return !canonicalId || !canonicalIds.has(canonicalId) || canonicalId === slot;
  });
  return [...new Set([...ROLLING_SLOTS, ...additions])];
}
export type RollingSlot = typeof CANONICAL_MENU_SLOTS[number]["id"];
export type RollingWeekStatus = "draft" | "imported" | "needs_review" | "ready" | "partially_published" | "published" | "archived";
export type RollingDayPublicationStatus = "draft" | "ready" | "published" | "superseded";
import type { CanonicalAllergenMap, OperationalAllergenState } from "./fika-contracts";
export type AllergenState = OperationalAllergenState;
export type AllergenMap = CanonicalAllergenMap;
export interface RollingAllocation { destinationId?: string; oneOffDestinationId?: string; destination?: import("@fika/server-shared/menu-destination").MenuDestination; destinationLabel: string; destinationAddress?: string; quantity: number; sourceLabel?: string; }
export interface RollingEntry { id: string; dayId: string; date: string; slot: string; itemId?: string; itemLabel: string; portions: number; allocations: RollingAllocation[]; /** Manual placement designation; absent historical values mean not Core. */ isCoreSalad?: boolean; allergens: AllergenMap; mayContainNotes?: string; allergenDetailNotes?: string; allergenReviewInvalidated?: boolean; allergenReview?: import("./fika-contracts").AllergenRowReview | import("../../shared/allergen-declaration").ExplicitRowReview; noKeyDeclaration?: import("../../shared/allergen-declaration").NoKeyDeclarationRecord; source?: { workbook: string; sheet: string; range: string; rawText?: string }; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingOneOffDestination { id: string; label: string; address?: string; addressStatus: "pending" | "confirmed"; contact?: string; deliveryInstructions?: string; }
export interface RollingDay { id: string; date: string; dayName: string; entryIds: string[]; oneOffDestinations?: RollingOneOffDestination[]; }
export interface RollingWeek { id: string; weekCommencing: string; weekEnding: string; status: RollingWeekStatus; version: number; dayIds: string[]; entryIds: string[]; sourceFiles: string[]; /** Explicit permission for Hospitality to show the current client-safe menu preview. Does not publish operational work. */ availableToHospitality?: boolean; /** Immutable-at-creation template snapshot; absent only on legacy weeks. */ templateSlots?: string[]; customSlots?: string[]; removedSlots?: string[]; dayStatuses?: Record<string, RollingDayPublicationStatus>; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingSnapshot { week: RollingWeek; days: RollingDay[]; entries: RollingEntry[]; }
/** Keep the standard Dessert rows visible in legacy drafts without rewriting saved history. */
export function plannerSlotsForWeek(week: RollingWeek) {
  const slots = week.templateSlots?.slice() || [...LEGACY_ROLLING_SLOTS];
  if (week.status === "draft") slots.push(...PERMANENT_DESSERT_SLOTS);
  return [...new Set(slots)];
}
export function assertMenuSlotCanBeRemoved(slot: string) {
  const clean = slot.trim().toLocaleUpperCase().replace(/\s+/g, " ");
  if ((NEVER_REMOVABLE_DESSERT_SLOTS as readonly string[]).includes(clean)) {
    throw Object.assign(new Error("Standard Dessert rows are permanent and cannot be removed."), { status: 409 });
  }
}
export function hasPlannedDishes(week: { entryIds?: readonly string[] }) { return (week.entryIds?.length || 0) > 0; }
