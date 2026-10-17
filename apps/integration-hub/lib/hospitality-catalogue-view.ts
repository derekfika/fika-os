/** Client-safe filtering, sorting and formatting for the Hospitality Catalogue table. Pure; no server imports. */
import { ROUTING_STATE_LABELS, type CataloguePayload, type CatalogueRow } from "./hospitality-catalogue-types";

export type CatalogueFilters = {
  query: string; category: string; route: "all" | CatalogueRow["routing"]["state"]; oplocId: string;
  status: "active" | "archived" | "all"; hasOverrides: boolean; needsReview: boolean; priceNotSet: boolean;
};
export const EMPTY_FILTERS: CatalogueFilters = { query: "", category: "", route: "all", oplocId: "", status: "active", hasOverrides: false, needsReview: false, priceNotSet: false };
export type SortKey = "name" | "category" | "production" | "price";
export type Sort = { key: SortKey; direction: "asc" | "desc" };

const norm = (value: string) => value.toLocaleLowerCase("en-GB");

export function rowMatches(row: CatalogueRow, filters: CatalogueFilters) {
  if (filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.category && row.category !== filters.category) return false;
  if (filters.route !== "all" && row.routing.state !== filters.route) return false;
  if (filters.oplocId && !row.offerings.some(offering => offering.status === "active" && offering.oplocId === filters.oplocId)) return false;
  if (filters.hasOverrides && !row.overrideCount) return false;
  if (filters.needsReview && !row.needsReview.length) return false;
  if (filters.priceNotSet && (row.defaultPrice || !row.offerings.some(offering => offering.mode === "standard" && offering.status === "active"))) return false;
  const query = norm(filters.query.trim());
  if (query) {
    const haystack = norm([row.name, row.category, row.description, ...row.sourceIds, ...row.providerMappings.flatMap(mapping => [mapping.provider, mapping.sourceItemId])].join(" "));
    if (!haystack.includes(query)) return false;
  }
  return true;
}

const priceOf = (row: CatalogueRow) => row.defaultPrice?.amount ?? row.offerings.find(offering => offering.price.effective)?.price.effective?.amount ?? Number.POSITIVE_INFINITY;
export function sortRows(rows: CatalogueRow[], sort: Sort) {
  const factor = sort.direction === "asc" ? 1 : -1;
  const compare = (a: CatalogueRow, b: CatalogueRow) => {
    if (sort.key === "category") return a.category.localeCompare(b.category, "en-GB");
    if (sort.key === "production") return ROUTING_STATE_LABELS[a.routing.state].localeCompare(ROUTING_STATE_LABELS[b.routing.state], "en-GB");
    if (sort.key === "price") return priceOf(a) === priceOf(b) ? 0 : priceOf(a) < priceOf(b) ? -1 : 1;
    return a.name.localeCompare(b.name, "en-GB");
  };
  return [...rows].sort((a, b) => factor * compare(a, b) || a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId));
}

export const formatMoney = (amount: number | undefined) => (amount === undefined ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount));
export const categoriesOf = (rows: CatalogueRow[]) => [...new Set(rows.map(row => row.category))].sort((a, b) => a.localeCompare(b, "en-GB"));

/** Operators see site names, never raw identifiers. Unknown/retired locations are labelled rather than shown by ID. */
export function oplocLabel(oplocs: CataloguePayload["oplocs"], oplocId: string) {
  const found = oplocs.find(oploc => oploc.oplocId === oplocId);
  return found ? (found.active ? found.label : `${found.label} (retired)`) : "Unrecognised location";
}

/** A targeted refresh has no review-group context, so the duplicate-candidate flag is re-derived from the loaded groups. */
export function withDuplicateFlag(row: CatalogueRow, groups: CataloguePayload["reviewGroups"]): CatalogueRow {
  const flagged = row.status === "active" && groups.some(group => (!group.decision || group.decision === "defer") && group.memberIds.includes(row.itemId));
  const rest = row.needsReview.filter(reason => reason !== "duplicate_candidate");
  return { ...row, needsReview: flagged ? [...rest, "duplicate_candidate"] : rest };
}

export function summariseCounts(rows: CatalogueRow[]): CataloguePayload["counts"] {
  const active = rows.filter(row => row.status === "active");
  return { active: active.length, archived: rows.length - active.length, needsReview: active.filter(row => row.needsReview.length).length, routingRequired: active.filter(row => row.routing.state === "routing_required").length };
}
