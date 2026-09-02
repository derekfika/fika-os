import type { MenuItem } from "./domain";

export type CatalogueUsage = "hospitality" | "delivered-in" | "production" | "unknown";

/** Keep package filters and live catalogue resolution on the same classification rules. */
export function catalogueUsagesFor(item: Pick<MenuItem, "category" | "subcategory">): CatalogueUsage[] {
  const value = `${item.category} ${item.subcategory || ""}`.toLowerCase();
  const usages: CatalogueUsage[] = [];
  if (value.includes("hospitality") || value.includes("sandwich") || value.includes("drink")) usages.push("hospitality");
  if (value.includes("delivered") || value.includes("lunch") || value.includes("salad") || value.includes("soup")) usages.push("delivered-in");
  if (value.includes("production") || value.includes("recipe")) usages.push("production");
  return usages.length ? usages : ["unknown"];
}
