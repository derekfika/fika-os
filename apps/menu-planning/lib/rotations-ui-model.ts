import { INITIAL_ROTATION_CATEGORIES, INITIAL_ROTATION_CYCLE_WEEKS, ROTATIONS_SCHEMA, type RotationConfiguration, type RotationHead } from "../../shared/hospitality-rotations";

export type RotationOption = { id: string; name: string; category: string; revision?: number };

/** Build a real first draft only after the manager has selected canonical records. */
export function initialRotationConfiguration(input: {
  label: string;
  anchorMonday: string;
  groupLabel: string;
  categoryId: string;
  itemId: string;
  dishes: RotationOption[];
}): RotationConfiguration {
  const bank = input.dishes.map((dish) => ({ dishId: dish.id, recipeRevision: dish.revision || 1 }));
  const firstDish = bank[0]?.dishId;
  return {
    schema: ROTATIONS_SCHEMA,
    label: input.label.trim(),
    calendar: { anchorMonday: input.anchorMonday, cycleWeeks: INITIAL_ROTATION_CYCLE_WEEKS, timeZone: "Europe/London" },
    categories: INITIAL_ROTATION_CATEGORIES.map((category) => ({ ...category })),
    groups: [{
      id: crypto.randomUUID(), label: input.groupLabel.trim(), categoryId: input.categoryId, itemId: input.itemId,
      dishBank: bank,
      weeks: Array.from({ length: INITIAL_ROTATION_CYCLE_WEEKS }, (_, index) => ({ week: index + 1, dishIds: firstDish ? [firstDish] : [] })),
      rules: { guests: { minimum: 6, maximum: 120, increment: 1 }, distinctDishes: { minimum: 1, maximum: 3 }, quantityPerDish: { minimum: 6, maximum: 60, increment: 6 }, unit: "pieces" },
    }],
  };
}

export function rotationActivationStatus(head: RotationHead, revision: number, today: string) {
  const activation = head.activations.find((item) => item.revision === revision);
  if (!activation) return "Unknown";
  if (activation.effectiveFrom > today) return "Scheduled";
  const current = [...head.activations].filter((item) => item.effectiveFrom <= today).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  return current?.revision === revision ? "Active" : "Historical";
}

/** Move one entry by a step within its list; out-of-range moves return the list unchanged. */
export function moveWithin<T>(values: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= values.length || target < 0 || target >= values.length) return [...values];
  const next = [...values];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Keep the planned order of dishes that stay selected, then append newly selected ones in the order picked. */
export function mergeSelectionOrder(previous: readonly string[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  return [...previous.filter((id) => chosen.has(id)), ...selected.filter((id) => !previous.includes(id))];
}
