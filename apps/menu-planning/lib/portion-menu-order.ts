import { canonicalMenuSlotIdFor, orderMenuEntries } from "../../shared/menu-section-order";

export function orderPortionPlannerEntries<T extends { id: string; slot: string }>(entries: readonly T[]): T[] {
  return orderMenuEntries(entries.map((entry, index) => ({
    entry,
    slot: canonicalMenuSlotIdFor(entry.slot) || entry.slot,
    originalIndex: index,
    sourceEntryId: entry.id,
  }))).map(({ entry }) => entry);
}
