import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import type { CataloguePayload, CatalogueRow } from "./catalogue-wire";

export type StudioProduct = { itemId: string; name: string; category: string };
export const normalizeCatalogueSearch = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-GB");

export function indexPublicCatalogue(result: CatalogueLoadResult) {
  const products: StudioProduct[] = result.catalogue.items.map(({ id: itemId, name, category }) => ({ itemId, name, category }));
  products.sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId));
  const sites = result.catalogue.oplocs.map(({ id, label: name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.id.localeCompare(b.id));
  const productsById = new Map(products.map(product => [product.itemId, product]));
  if (productsById.size !== products.length || new Set(sites.map(site => site.id)).size !== sites.length ||
      products.some(product => typeof product.category !== "string")) {
    throw new Error("The public catalogue contains invalid product or site records.");
  }
  return { hash: result.contentHash, products, sites, productsById };
}

export function indexAdminCatalogue(data?: CataloguePayload) {
  const rows = data?.rows ?? [];
  const sites = data?.oplocs.filter(site => site.active) ?? [];
  const byCategory = new Map<string, CatalogueRow[]>();
  const bySite = new Map<string, CatalogueRow[]>();
  const byStatus = new Map<string, CatalogueRow[]>();
  function add(map: Map<string, CatalogueRow[]>, key: string, row: CatalogueRow) {
    const group = map.get(key);
    if (group) group.push(row);
    else map.set(key, [row]);
  }
  const searchable = new Map<string, string>();
  for (const row of rows) {
    add(byCategory, row.category, row);
    add(byStatus, row.status, row);
    for (const id of row.availableAt) add(bySite, id, row);
    searchable.set(row.itemId, normalizeCatalogueSearch([row.name, row.category, row.status].join(" ")));
  }
  return {
    rows, rowsById: new Map(rows.map(row => [row.itemId, row])), sites,
    siteLabels: new Map(sites.map(site => [site.oplocId, site.label])),
    categories: [...byCategory.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "en-GB")),
    byCategory, bySite, byStatus, searchable,
  };
}
