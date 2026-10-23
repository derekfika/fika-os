import { categoriesForMenuSlot, isCanonicalDishCategory, normaliseDishCategory } from "./dish-categories";
import type { RollingEntry, RollingSnapshot } from "./rolling-menu-types";

export type CopyableDish = { id: string; name: string; category?: string };
export type DishCopyTarget = { dayId: string; slot: string };
export type DishCopyAssessment =
  | { allowed: true; dish: CopyableDish; blankTarget?: RollingEntry }
  | { allowed: false; reason: string };

function trulyEmpty(entry: RollingEntry) {
  return !entry.itemId?.trim() && !entry.itemLabel.trim() && entry.portions === 0 && entry.allocations.length === 0 && Object.keys(entry.allergens || {}).length === 0 && !entry.mayContainNotes?.trim();
}

export function copyableDishForSource(snapshot: RollingSnapshot, dishes: readonly CopyableDish[], sourceEntryId: string) {
  const source = snapshot.entries.find(entry => entry.id === sourceEntryId);
  if (!source?.itemId?.trim() || !source.itemLabel.trim() || !snapshot.days.some(day => day.id === source.dayId && snapshot.week.dayIds.includes(day.id))) return undefined;
  const dish = dishes.find(candidate => candidate.id === source.itemId);
  const category = normaliseDishCategory(dish?.category);
  return dish?.name.trim() && isCanonicalDishCategory(category) && categoriesForMenuSlot(source.slot).includes(category) ? dish : undefined;
}

export function assessDishCopyTarget(
  snapshot: RollingSnapshot,
  dishes: readonly CopyableDish[],
  sourceEntryId: string,
  target: DishCopyTarget,
): DishCopyAssessment {
  const source = snapshot.entries.find(entry => entry.id === sourceEntryId);
  if (!source?.itemId?.trim() || !source.itemLabel.trim()) return { allowed: false, reason: "The source dish is no longer available to copy." };
  const sourceDay = snapshot.days.find(day => day.id === source.dayId && snapshot.week.dayIds.includes(day.id));
  const targetDay = snapshot.days.find(day => day.id === target.dayId && snapshot.week.dayIds.includes(day.id));
  if (!sourceDay || !targetDay) return { allowed: false, reason: "Choose a day in this menu week." };
  if (source.dayId === target.dayId && source.slot === target.slot) return { allowed: false, reason: "Choose a different menu cell." };
  if (source.dayId === target.dayId) return { allowed: false, reason: "Copy the dish to a different day." };

  const dish = dishes.find(candidate => candidate.id === source.itemId);
  if (!dish?.name.trim()) return { allowed: false, reason: "The canonical Dish Library item could not be verified." };
  const category = normaliseDishCategory(dish.category);
  if (!isCanonicalDishCategory(category) || !categoriesForMenuSlot(source.slot).includes(category) || !categoriesForMenuSlot(target.slot).includes(category)) {
    return { allowed: false, reason: "This dish is not compatible with both menu categories." };
  }

  const matches = snapshot.entries.filter(entry => entry.dayId === target.dayId && entry.slot === target.slot);
  if (matches.length > 1) return { allowed: false, reason: "The target cell has conflicting menu entries. Refresh the week before copying." };
  const existing = matches[0];
  if (existing && !trulyEmpty(existing)) return { allowed: false, reason: "The target cell is already occupied." };
  return { allowed: true, dish, blankTarget: existing };
}

export function compatibleDishCopyTargets(
  snapshot: RollingSnapshot,
  dishes: readonly CopyableDish[],
  sourceEntryId: string,
  slots: readonly string[],
): Array<DishCopyTarget & { key: string; label: string }> {
  return snapshot.days.flatMap(day => slots.flatMap(slot => {
    const result = assessDishCopyTarget(snapshot, dishes, sourceEntryId, { dayId: day.id, slot });
    return result.allowed ? [{ dayId: day.id, slot, key: `${day.id}|${slot}`, label: `${day.dayName} · ${slot}` }] : [];
  }));
}
