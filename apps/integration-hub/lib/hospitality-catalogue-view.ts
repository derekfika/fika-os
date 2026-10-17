/** Client-safe filtering, sorting and formatting for the Hospitality Catalogue table. Pure; no server imports. */
import { ROUTING_CHOICE_LABELS, ROUTING_STATE_LABELS, type CataloguePayload, type CatalogueRow, type RoutingChoice } from "./hospitality-catalogue-types";

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

// ----- sites ---------------------------------------------------------------------------------------------------
/** Locations "Select all sites" covers: active and hospitality-capable per the server (never inactive/archived ones). */
export const selectableSites = (oplocs: CataloguePayload["oplocs"]) => oplocs.filter(oploc => oploc.active && oploc.hospitality);

/** Compact availability text for the table: "All sites" when every selectable site has an active Offering. */
export function sitesSummary(row: CatalogueRow, oplocs: CataloguePayload["oplocs"]) {
  const selectable = selectableSites(oplocs);
  const offered = new Set(row.availableAt);
  if (!offered.size) return "Not available anywhere";
  if (selectable.length > 0 && selectable.every(oploc => offered.has(oploc.oplocId))) return "All sites";
  const labels = [...offered].map(id => oplocLabel(oplocs, id));
  return labels.length <= 2 ? labels.join(", ") : `${labels.length} of ${selectable.length || labels.length} sites`;
}

// ----- selection -----------------------------------------------------------------------------------------------
/** Only active rows are selectable; archived history is never silently included in a bulk change. */
export const selectableRows = (rows: CatalogueRow[]) => rows.filter(row => row.status === "active");
/** Selection always follows the current result set: ids that dropped out of the filter are discarded. */
export const pruneSelection = (selected: ReadonlySet<string>, shown: CatalogueRow[]) => { const allowed = new Set(selectableRows(shown).map(row => row.itemId)); return new Set([...selected].filter(id => allowed.has(id))); };
export const selectAllShown = (shown: CatalogueRow[]) => new Set(selectableRows(shown).map(row => row.itemId));
export function toggleSelection(selected: ReadonlySet<string>, itemId: string) { const next = new Set(selected); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; }

// ----- bulk impact preview -------------------------------------------------------------------------------------
export type BulkDraft = {
  production?: RoutingChoice; price?: { amount: number }; minimum?: { mode: "set"; value: number } | { mode: "clear" };
  sites?: { mode: "add" | "remove" | "replace"; oplocIds: string[] }; archive?: boolean;
};
export type ImpactLine = { label: string; value: string; tone?: "warning" | "danger" };

export function bulkImpact(draft: BulkDraft, selected: CatalogueRow[], oplocs: CataloguePayload["oplocs"]): ImpactLine[] {
  const n = selected.length; const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const lines: ImpactLine[] = [];
  if (draft.archive) return [{ label: "Archive", value: `${plural(n, "item")} will be archived and removed from booking menus at every site. Existing bookings, quotes, orders, prices, routing and history are kept; each can be restored.`, tone: "danger" }, { label: "Existing site overrides", value: "Preserved" }];
  if (draft.production) {
    const current = new Map<string, number>(); for (const row of selected) current.set(ROUTING_STATE_LABELS[row.routing.state], (current.get(ROUTING_STATE_LABELS[row.routing.state]) || 0) + 1);
    const changing = selected.filter(row => row.routing.state !== draft.production).length;
    lines.push({ label: "Production", value: `${plural(changing, "item")} → ${ROUTING_CHOICE_LABELS[draft.production]}${changing < n ? ` (${n - changing} already set)` : ""}` });
    if (current.size > 1) lines.push({ label: "Mixed current routes", value: [...current].map(([label, count]) => `${count} ${label}`).join(" · "), tone: "warning" });
  } else lines.push({ label: "Production", value: "Unchanged" });
  lines.push({ label: "Price", value: draft.price ? `Set company default to ${formatMoney(draft.price.amount)} on ${plural(n, "item")}` : "Unchanged" });
  lines.push({ label: "Minimum", value: draft.minimum ? (draft.minimum.mode === "set" ? `Set company default to ${draft.minimum.value} on ${plural(n, "item")}` : `Clear the company default on ${plural(n, "item")}; sites inheriting it will have no minimum`) : "Unchanged" });
  if (draft.sites) {
    const names = draft.sites.oplocIds.map(id => oplocLabel(oplocs, id)); const wanted = new Set(draft.sites.oplocIds);
    const offered = (row: CatalogueRow) => new Set(row.availableAt);
    const adds = selected.reduce((sum, row) => sum + [...wanted].filter(id => !offered(row).has(id)).length, 0);
    const removes = selected.reduce((sum, row) => sum + (draft.sites!.mode === "remove" ? [...wanted].filter(id => offered(row).has(id)).length : draft.sites!.mode === "replace" ? row.availableAt.filter(id => !wanted.has(id)).length : 0), 0);
    const list = names.length > 4 ? `${names.length} sites` : names.join(", ");
    if (draft.sites.mode === "add") lines.push({ label: "Site availability", value: `Add ${list}: ${plural(adds, "new offering")}; new offerings inherit company price and minimum` });
    else if (draft.sites.mode === "remove") lines.push({ label: "Site availability", value: `Remove ${list}: ${plural(removes, "offering")} disabled (overrides and history kept)`, tone: "danger" });
    else lines.push({ label: "Site availability", value: `Replace with ${list}: ${plural(adds, "offering")} added, ${plural(removes, "offering")} disabled (overrides and history kept)`, ...(removes ? { tone: "danger" as const } : {}) });
  } else lines.push({ label: "Site availability", value: "Unchanged" });
  lines.push({ label: "Existing site overrides", value: "Preserved" });
  return lines;
}
