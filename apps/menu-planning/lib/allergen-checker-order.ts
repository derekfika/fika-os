export type AllergenOrderEntry = { id: string; slot: string };

/** Follow the exact Week Planner slot sequence; keep repeated entries in their saved order within a slot. */
export function orderAllergenCheckerEntries<T extends AllergenOrderEntry>(entries: readonly T[], plannerSlotOrder: readonly string[]): T[] {
  const positions = new Map(plannerSlotOrder.map((slot, index) => [slot, index]));
  return entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex, slotIndex: positions.get(entry.slot) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.slotIndex - right.slotIndex || left.sourceIndex - right.sourceIndex)
    .map(({ entry }) => entry);
}
