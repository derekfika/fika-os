import type { RollingDay, RollingEntry, RollingWeek } from "./rolling-menu-types";
import { normaliseOperationalAllergens } from "./fika-contracts";

export type RollingEntryPatch = Partial<Pick<RollingEntry, "itemId" | "itemLabel" | "portions" | "slot" | "allocations" | "allergens" | "mayContainNotes" | "allergenReviewInvalidated">>;
export type RollingDayPatch = Partial<Pick<RollingDay, "entryIds" | "oneOffDestinations">>;
export type RollingWeekPatch = Partial<Pick<RollingWeek, "status" | "sourceFiles" | "customSlots" | "removedSlots" | "dayStatuses" | "entryIds">>;
export type RollingMutationCommand = {
  weekId: string;
  expectedWeekVersion: number;
  touchedEntryIds: string[];
  touchedDayIds: string[];
  entryDayIds?: Record<string, string>;
  patch: {
    entries?: Record<string, RollingEntryPatch>;
    days?: Record<string, RollingDayPatch>;
    week?: RollingWeekPatch;
  };
  audit: { action: string; at: string; by: string };
};
export type RollingMutationDelta = { week: RollingWeek; days: RollingDay[]; entries: RollingEntry[] };

export function applyRollingEntryPatch(entry: RollingEntry, patch: RollingEntryPatch) {
  const nextItemId = patch.itemId !== undefined ? patch.itemId || "" : entry.itemId || "";
  const nextLabel = patch.itemLabel !== undefined ? String(patch.itemLabel).trim().toLocaleLowerCase() : entry.itemLabel.trim().toLocaleLowerCase();
  const dishChanged = nextItemId !== (entry.itemId || "") || nextLabel !== entry.itemLabel.trim().toLocaleLowerCase();
  const restoringReview = patch.allergenReviewInvalidated === false && patch.allergens !== undefined;
  const normalizedPatch = patch.allergens !== undefined ? { ...patch, allergens: normaliseOperationalAllergens(patch.allergens) } : patch;
  Object.assign(entry, { ...normalizedPatch, ...(patch.itemLabel !== undefined ? { itemLabel: String(patch.itemLabel).trim() } : {}), ...(patch.allergens !== undefined && patch.allergenReviewInvalidated === undefined ? { allergenReviewInvalidated: false } : {}), ...(dishChanged && !restoringReview ? { allergens: {}, mayContainNotes: "", allergenReviewInvalidated: true } : {}) });
  return dishChanged;
}

export function commandEntryIds(command: RollingMutationCommand) {
  return [...new Set(command.touchedEntryIds.filter(Boolean))];
}

export function commandDayIds(command: RollingMutationCommand) {
  return [...new Set(command.touchedDayIds.filter(Boolean))];
}
