export type PublishedMenuDaySummary = { date: string; version: number; status: string };
export type PublishedMenuPublicationSummary = { weekCommencing: string };
export type PublishedMenuAllocation = { destinationLabel: string; quantity: number };
export type PublishedMenuEntrySummary = { slot: string; dishName: string; portions: number; canonicalDishId?: string; allocations: PublishedMenuAllocation[] };
export type DestinationProductionGroup = { destinationLabel: string; total: number; entries: Array<{ slot: string; dishName: string; quantity: number }> };
export type ProductionTotal = { slot: string; dishName: string; quantity: number; canonicalDishId?: string };
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
  for (const entry of entries) {
    for (const allocation of entry.allocations) {
      const key = allocation.destinationLabel.trim() || "Unassigned destination";
      const group = groups.get(key) || { destinationLabel: key, total: 0, entries: [] };
      group.total += allocation.quantity;
      group.entries.push({ slot: entry.slot, dishName: entry.dishName, quantity: allocation.quantity });
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
  const totals = new Map<string, ProductionTotal>();
  for (const entry of entries) {
    const quantity = entry.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    const normalizedName = entry.dishName.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const key = entry.canonicalDishId ? `id:${entry.canonicalDishId}` : `name:${normalizedName}`;
    const existing = totals.get(key);
    if (existing) existing.quantity += quantity;
    else totals.set(key, { slot: entry.slot, dishName: entry.dishName, quantity, ...(entry.canonicalDishId ? { canonicalDishId: entry.canonicalDishId } : {}) });
  }
  return [...totals.values()];
}
