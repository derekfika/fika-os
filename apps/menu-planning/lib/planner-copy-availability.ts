import { categoriesForMenuSlot, isCanonicalDishCategory, normaliseDishCategory } from "./dish-categories";
import type { CopyableDish } from "./dish-copy";
import type { RollingEntry, RollingSnapshot } from "./rolling-menu-types";
import type { SpellerLike } from "./menu-spellcheck";

/** One immutable loaded dictionary instance; ignore/add lists are still applied by each caller. */
export function memoizePlannerSpeller(speller: SpellerLike): SpellerLike {
  const correct = new Map<string, boolean>(), suggestions = new Map<string, string[]>();
  return {
    correct(word) {
      if (!correct.has(word)) { if (correct.size >= 1024) correct.clear(); correct.set(word, speller.correct(word)); }
      return correct.get(word)!;
    },
    suggest(word) {
      if (!suggestions.has(word)) { if (suggestions.size >= 1024) suggestions.clear(); suggestions.set(word, [...speller.suggest(word)]); }
      return [...suggestions.get(word)!];
    },
  };
}

/** Render-only indexes. Explicit Copy/drag actions still run the authoritative assessment. */
export function plannerCopyAvailability(snapshot: RollingSnapshot, dishes: readonly CopyableDish[], slots: readonly string[]) {
  const entriesByCell = new Map<string, RollingEntry>();
  const counts = new Map<string, number>();
  const dishesById = new Map<string, CopyableDish>();
  for (const dish of dishes) if (!dishesById.has(dish.id)) dishesById.set(dish.id, dish);
  for (const entry of snapshot.entries) {
    const key = JSON.stringify([entry.dayId, entry.slot]);
    if (!entriesByCell.has(key)) entriesByCell.set(key, entry);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const emptyDaysByCategory = new Map<string, Set<string>>();
  if (snapshot.week.status !== "published") for (const day of snapshot.days.slice(0, 5)) {
    if (!snapshot.week.dayIds.includes(day.id) || snapshot.week.dayStatuses?.[day.id] === "published") continue;
    for (const slot of new Set(slots)) {
      const key = JSON.stringify([day.id, slot]), entry = entriesByCell.get(key);
      if ((counts.get(key) || 0) > 1) continue;
      if (entry && (entry.itemId?.trim() || entry.itemLabel.trim() || entry.portions !== 0 || entry.allocations.length || Object.keys(entry.allergens || {}).length || entry.mayContainNotes?.trim())) continue;
      for (const category of categoriesForMenuSlot(slot)) {
        if (!emptyDaysByCategory.has(category)) emptyDaysByCategory.set(category, new Set());
        emptyDaysByCategory.get(category)!.add(day.id);
      }
    }
  }
  const copyableByEntry = new Map<string, CopyableDish>(), available = new Set<string>();
  const seenSources = new Set<string>();
  for (const entry of snapshot.entries) {
    if (seenSources.has(entry.id)) continue;
    seenSources.add(entry.id);
    const dish = dishesById.get(entry.itemId || ""), category = normaliseDishCategory(dish?.category);
    if (!entry.itemId?.trim() || !entry.itemLabel.trim() || !dish?.name.trim() || !isCanonicalDishCategory(category) || !categoriesForMenuSlot(entry.slot).includes(category) || !snapshot.days.some(day => day.id === entry.dayId && snapshot.week.dayIds.includes(day.id))) continue;
    copyableByEntry.set(entry.id, dish);
    if ([...(emptyDaysByCategory.get(category) || [])].some(dayId => dayId !== entry.dayId)) available.add(entry.id);
  }
  return { entriesByCell, copyableByEntry, available };
}
