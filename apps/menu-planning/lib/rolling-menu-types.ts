export const ROLLING_SLOTS = [
  "SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6",
  "HOT MAIN", "VEGAN MAIN", "COLD PROTEIN", "SOUP",
  "STARCH/SIDE 1", "STARCH/SIDE 2", "STARCH/SIDE 3", "STARCH/SIDE 4",
  "GARNISH 1", "GARNISH 2", "GARNISH 3", "GARNISH 4",
  "SAUCE 1", "SAUCE 2", "SAUCE 3", "SAUCE 4",
  "DESSERT 1", "DESSERT 2", "DESSERT 3",
] as const;
export const PERMANENT_DESSERT_SLOTS = ["DESSERT 1", "DESSERT 2", "DESSERT 3"] as const;
/** Slots found in older saved weeks remain readable and retain their historical ordering. */
export const LEGACY_ROLLING_SLOTS = ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6", "COLD PROTEIN", "SOUP", "HOT MEAT", "HOT VEG VEGAN", "EXTRAS 1", "EXTRAS 2", "EXTRAS 3", "EXTRAS 4", "EXTRAS 5", "EXTRAS 6"] as const;
export type RollingSlot = typeof ROLLING_SLOTS[number];
export type RollingWeekStatus = "draft" | "imported" | "needs_review" | "ready" | "partially_published" | "published" | "archived";
export type RollingDayPublicationStatus = "draft" | "ready" | "published" | "superseded";
import type { CanonicalAllergenMap, OperationalAllergenState } from "./fika-contracts";
export type AllergenState = OperationalAllergenState;
export type AllergenMap = CanonicalAllergenMap;
export interface RollingAllocation { destinationId?: string; destinationLabel: string; destinationAddress?: string; quantity: number; sourceLabel?: string; }
export interface RollingEntry { id: string; dayId: string; date: string; slot: string; itemId?: string; itemLabel: string; portions: number; allocations: RollingAllocation[]; allergens: AllergenMap; mayContainNotes?: string; allergenReviewInvalidated?: boolean; allergenReview?: import("./fika-contracts").AllergenRowReview; source?: { workbook: string; sheet: string; range: string; rawText?: string }; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingOneOffDestination { id: string; label: string; address?: string; addressStatus: "pending" | "confirmed"; }
export interface RollingDay { id: string; date: string; dayName: string; entryIds: string[]; oneOffDestinations?: RollingOneOffDestination[]; }
export interface RollingWeek { id: string; weekCommencing: string; weekEnding: string; status: RollingWeekStatus; version: number; dayIds: string[]; entryIds: string[]; sourceFiles: string[]; /** Immutable-at-creation template snapshot; absent only on legacy weeks. */ templateSlots?: string[]; customSlots?: string[]; removedSlots?: string[]; dayStatuses?: Record<string, RollingDayPublicationStatus>; audit: Array<{ action: string; at: string; by: string }>; }
export interface RollingSnapshot { week: RollingWeek; days: RollingDay[]; entries: RollingEntry[]; }
/** Keep the standard Dessert rows visible in legacy drafts without rewriting saved history. */
export function plannerSlotsForWeek(week: RollingWeek) {
  const slots = week.templateSlots?.slice() || [...LEGACY_ROLLING_SLOTS];
  if (week.status === "draft") slots.push(...PERMANENT_DESSERT_SLOTS);
  return [...new Set(slots)];
}
export function assertMenuSlotCanBeRemoved(slot: string) {
  const clean = slot.trim().toLocaleUpperCase().replace(/\s+/g, " ");
  if ((PERMANENT_DESSERT_SLOTS as readonly string[]).includes(clean)) {
    throw Object.assign(new Error("The three standard Dessert rows are permanent and cannot be removed."), { status: 409 });
  }
}
export function hasPlannedDishes(week: { entryIds?: readonly string[] }) { return (week.entryIds?.length || 0) > 0; }
