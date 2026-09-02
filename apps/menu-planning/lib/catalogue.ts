import { getCanonicalMenuItemById, listCanonicalMenuItems, listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import type { MenuItem } from "./domain";
import { normaliseDishCategory } from "./dish-categories";
import { attachCanonicalDishIds, getWeek, listAllEntries } from "./rolling-menu";
import { syncRollingEntries } from "./canonical-menu-repository";
import { catalogueUsagesFor, type CatalogueUsage } from "./catalogue-usage";

export type CatalogueKind = "canonical";

export type CatalogueEntry = {
  id: string;
  kind: CatalogueKind;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  usage: CatalogueUsage[];
  status: string;
  reviewStatus?: string;
  sourceLabel: string;
  sourceEvidence?: string;
  recipeAvailable: boolean;
  allergenCount: number;
  parentMenuItemKey?: string;
  canonicalItemId?: string;
  item?: MenuItem;
  sandwich?: never;
};

function categoryFor(item: Pick<MenuItem, "category" | "subcategory">) {
  return normaliseDishCategory(item.category || item.subcategory);
}

function canonicalEntry(item: MenuItem): CatalogueEntry {
  return {
    id: item.canonicalId,
    kind: "canonical",
    name: item.displayName,
    description: item.description || item.preparationDescription,
    category: categoryFor(item),
    subcategory: item.subcategory,
    usage: catalogueUsagesFor(item),
    status: item.recipeStatus || item.reviewStatus,
    reviewStatus: item.reviewStatus,
    sourceLabel: item.sourceName,
    sourceEvidence: `${item.sourceReference.workbook} · ${item.sourceReference.sheet}${item.sourceReference.range ? ` · ${item.sourceReference.range}` : ""}`,
    recipeAvailable: Boolean(item.ingredients?.length || item.methodSteps?.length || item.preparationDescription),
    allergenCount: item.allergenEvidence.filter((evidence) => evidence.value !== "unknown").length,
    item,
  };
}

/** The catalogue is deliberately backed only by explicitly promoted canonical records. */
export async function listCatalogueEntries(): Promise<CatalogueEntry[]> {
  const items = await listCanonicalMenuItems();
  // Archived records are retained for history and audit, but must not leak into
  // operational dish pickers or normal planner catalogue results.
  return items.filter(item => item.reviewStatus !== "archived").map(canonicalEntry).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCatalogueEntriesForIds(ids: string[]): Promise<CatalogueEntry[]> {
  return (await listCanonicalMenuItemsByIds(ids)).filter(item => item.reviewStatus !== "archived").map(canonicalEntry).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCatalogueEntryById(id: string): Promise<CatalogueEntry | undefined> {
  const item = await getCanonicalMenuItemById(id);
  return item && item.reviewStatus !== "archived" ? canonicalEntry(item) : undefined;
}

/** Explicit maintenance reconciliation for imports and publication preparation. */
export async function reconcileCatalogueFromRollingEntries(scope?: { weekId: string; dayId?: string }) {
  const entries = scope ? getWeek(scope.weekId).then(snapshot => snapshot.entries.filter(entry => !scope.dayId || entry.dayId === scope.dayId)) : listAllEntries();
  const items = await syncRollingEntries(await entries);
  await attachCanonicalDishIds(items, "rolling-menu-migration", scope);
}

export function filterCatalogueEntries(entries: CatalogueEntry[], filters: { query?: string; category?: string; usage?: string; status?: string }) {
  const query = filters.query?.trim().toLowerCase() || "";
  return entries.filter((entry) => {
    const haystack = [entry.name, entry.description, entry.category, entry.subcategory, entry.sourceLabel, entry.sourceEvidence].filter(Boolean).join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!filters.category || filters.category === "all" || entry.category === filters.category) && (!filters.usage || filters.usage === "all" || entry.usage.includes(filters.usage as CatalogueUsage)) && (!filters.status || filters.status === "all" || entry.status === filters.status || entry.reviewStatus === filters.status);
  });
}
