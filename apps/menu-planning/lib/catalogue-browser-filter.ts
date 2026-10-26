import type { CatalogueEntry } from "./catalogue";

/** Browser-side Dish Library search, extracted unchanged from the client component so it can be tested. */
export function filterCatalogueBrowserEntries(entries: CatalogueEntry[], query: string, category: string, usage: string, status: string) {
  return entries.filter(entry => {
    const haystack = `${entry.id} ${entry.name} ${entry.description || ""} ${entry.sourceLabel}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (category === "all" || entry.category === category) && (usage === "all" || (entry.usage as string[]).includes(usage)) && (status === "all" || entry.status === status);
  });
}
