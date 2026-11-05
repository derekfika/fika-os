import { canonicalMenuSlotIdFor, orderMenuEntries } from "../../shared/menu-section-order";

export type PublishedMenuDaySummary = { date: string; version: number; status: string };
export type PublishedMenuPublicationSummary = { weekCommencing: string };
export type PublishedMenuAllocation = { destinationLabel: string; quantity: number };
export type PublishedMenuEntrySummary = { slot: string; dishName: string; portions: number; canonicalDishId?: string; sourceEntryId?: string; menuOrderVersion?: string; canonicalSlotId?: string; canonicalOrderIndex?: number; allocations: PublishedMenuAllocation[] };
export type DestinationProductionGroup = { destinationLabel: string; total: number; entries: Array<{ slot: string; dishName: string; quantity: number; sourceEntryId?: string; canonicalSlotId?: string; canonicalOrderIndex?: number }> };
export type ProductionTotal = { slot: string; dishName: string; quantity: number; canonicalDishId?: string; canonicalSlotId?: string; canonicalOrderIndex?: number; menuOrderVersion?: string; slots: Array<{ slot: string; canonicalSlotId?: string; canonicalOrderIndex?: number }> };
export function publishedMatrixUrl(publicationId: string, publicationDayId: string) { return `/api/menu-publications?publicationId=${encodeURIComponent(publicationId)}&publicationDayId=${encodeURIComponent(publicationDayId)}&format=matrix`; }

export function currentPublishedDays<T extends PublishedMenuDaySummary>(days: T[] = []) {
  const latest = new Map<string, T>();
  for (const day of days) {
    if (day.status !== "published") continue;
    const existing = latest.get(day.date);
    if (!existing || day.version > existing.version) latest.set(day.date, day);
  }
  return latest;
}

export function sortPublishedMenuPublications<T extends PublishedMenuPublicationSummary>(publications: T[] = []) {
  return publications.slice().sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));
}

export function groupEntriesByDestination(entries: PublishedMenuEntrySummary[] = []) {
  const groups = new Map<string, DestinationProductionGroup>();
  const ordered = orderMenuEntries(entries.map((entry, index) => ({ entry, slot: canonicalMenuSlotIdFor(entry.canonicalSlotId || "") || canonicalMenuSlotIdFor(entry.slot) || entry.slot, originalIndex: entry.canonicalOrderIndex ?? index, sourceEntryId: entry.sourceEntryId })));
  for (const { entry } of ordered) {
    for (const allocation of entry.allocations) {
      const key = allocation.destinationLabel.trim() || "Unassigned destination";
      const group = groups.get(key) || { destinationLabel: key, total: 0, entries: [] };
      group.total += allocation.quantity;
      group.entries.push({ slot: entry.slot, dishName: entry.dishName, quantity: allocation.quantity, ...(entry.sourceEntryId ? { sourceEntryId: entry.sourceEntryId } : {}), ...(entry.canonicalSlotId ? { canonicalSlotId: entry.canonicalSlotId } : {}), ...(entry.canonicalOrderIndex !== undefined ? { canonicalOrderIndex: entry.canonicalOrderIndex } : {}) });
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

export function summarizePublishedDays(days: Array<{ groups: DestinationProductionGroup[] }> = []) {
  const locations = new Set<string>();
  let portions = 0;
  for (const day of days) for (const group of day.groups) { portions += group.total; locations.add(group.destinationLabel); }
  return { portions, locations: locations.size, days: days.length };
}

export function aggregateProductionTotals(entries: PublishedMenuEntrySummary[] = []) {
  const totals = new Map<string, ProductionTotal & { originalIndex: number; sourceEntryId?: string }>();
  const ordered = orderMenuEntries(entries.map((entry, index) => ({ entry, slot: canonicalMenuSlotIdFor(entry.canonicalSlotId || "") || canonicalMenuSlotIdFor(entry.slot) || entry.slot, originalIndex: entry.canonicalOrderIndex ?? index, sourceEntryId: entry.sourceEntryId })));
  ordered.forEach(({ entry }, index) => {
    const quantity = entry.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    const normalizedName = entry.dishName.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    // Production totals describe the canonical dish once, even when the same
    // dish appears in multiple menu slots. The first canonical slot determines
    // its position; destination rows retain the distinct slot occurrences.
    const key = entry.canonicalDishId ? `id:${entry.canonicalDishId}` : `name:${normalizedName}`;
    const existing = totals.get(key);
    const slot = { slot: entry.slot, ...(entry.canonicalSlotId ? { canonicalSlotId: entry.canonicalSlotId } : {}), ...(entry.canonicalOrderIndex !== undefined ? { canonicalOrderIndex: entry.canonicalOrderIndex } : {}) };
    if (existing) {
      existing.quantity += quantity;
      if (!existing.slots.some(item => (item.canonicalSlotId || item.slot) === (slot.canonicalSlotId || slot.slot))) existing.slots.push(slot);
    } else totals.set(key, { slot: entry.slot, dishName: entry.dishName, quantity, slots: [slot], originalIndex: entry.canonicalOrderIndex ?? index, ...(entry.canonicalDishId ? { canonicalDishId: entry.canonicalDishId } : {}), ...(entry.canonicalSlotId ? { canonicalSlotId: entry.canonicalSlotId } : {}), ...(entry.canonicalOrderIndex !== undefined ? { canonicalOrderIndex: entry.canonicalOrderIndex } : {}), ...(entry.menuOrderVersion ? { menuOrderVersion: entry.menuOrderVersion } : {}), ...(entry.sourceEntryId ? { sourceEntryId: entry.sourceEntryId } : {}) });
  });
  return orderMenuEntries([...totals.values()].map((entry, index) => ({ entry, slot: canonicalMenuSlotIdFor(entry.canonicalSlotId || "") || canonicalMenuSlotIdFor(entry.slot) || entry.slot, originalIndex: entry.canonicalOrderIndex ?? entry.originalIndex ?? index, sourceEntryId: entry.sourceEntryId }))).map(({ entry }) => entry);
}
