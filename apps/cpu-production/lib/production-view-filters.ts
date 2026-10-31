import type { ProductionOrder } from "./production-types";
import { cpuDestinationOptionLabel, isCpuWithdrawn } from "./production-presentation";

/**
 * Shared, read-only view filters for the CPU Production Week, Day, Queue, Run sheet,
 * Totals and legacy /calendar views.
 *
 * Site identity is the canonical `destinationOplocId`. Display labels are presentation
 * only. Orders with no OPLOC (for example one-off destination snapshots) are never given
 * a made-up identity: they stay visible under "All sites" and are excluded, with a
 * disclosure, from any explicit site selection.
 */

export type SiteOption = { id: string; label: string; count: number };

/** Distinct canonical sites in the loaded orders, with a count of distinct orders per site. */
export function buildSiteOptions(orders: readonly ProductionOrder[]): SiteOption[] {
  const bySite = new Map<string, { label: string; orders: Set<string> }>();
  for (const order of orders) {
    const id = order.destinationOplocId;
    if (!id) continue;
    const entry = bySite.get(id) || { label: cpuDestinationOptionLabel(order), orders: new Set<string>() };
    entry.orders.add(order.canonicalId);
    bySite.set(id, entry);
  }
  // Duplicate human labels stay separate options because identity is the OPLOC ID; the ID breaks ties.
  return [...bySite.entries()]
    .map(([id, entry]) => ({ id, label: entry.label, count: entry.orders.size }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-GB") || a.id.localeCompare(b.id));
}

const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function searchSiteOptions(options: readonly SiteOption[], query: string): SiteOption[] {
  const terms = fold(query).split(" ").filter(Boolean);
  if (!terms.length) return [...options];
  return options.filter((option) => {
    const haystack = fold(option.label);
    return terms.every((term) => haystack.includes(term));
  });
}

/** An empty selection means every site. */
export function orderMatchesSites(order: Pick<ProductionOrder, "destinationOplocId">, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  return Boolean(order.destinationOplocId) && selected.includes(order.destinationOplocId as string);
}

export function filterOrdersBySites<T extends Pick<ProductionOrder, "destinationOplocId">>(orders: readonly T[], selected: readonly string[]): T[] {
  return orders.filter((order) => orderMatchesSites(order, selected));
}

/** Distinct orders that have no canonical OPLOC and so cannot be matched by a site selection. */
export function unscopedOrderCount(orders: readonly Pick<ProductionOrder, "canonicalId" | "destinationOplocId">[]): number {
  return new Set(orders.filter((order) => !order.destinationOplocId).map((order) => order.canonicalId)).size;
}

export function toggleSite(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/** Add every given option (for "Select all shown") without dropping selections hidden by a search. */
export function selectShown(selected: readonly string[], shown: readonly SiteOption[]): string[] {
  return [...new Set([...selected, ...shown.map((option) => option.id)])];
}

export type FilterChip = { key: string; label: string; kind: "site" | "status" | "origin" };

export function activeFilterChips(input: {
  sites: readonly string[];
  siteLabels: ReadonlyMap<string, string>;
  status?: string;
  statusLabel?: string;
  origin?: string;
  originLabel?: string;
}): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const id of input.sites) chips.push({ key: `site:${id}`, kind: "site", label: `Site: ${input.siteLabels.get(id) || "Site not in this view"}` });
  if (input.status) chips.push({ key: "status", kind: "status", label: `Status: ${input.statusLabel || input.status}` });
  if (input.origin) chips.push({ key: "origin", kind: "origin", label: `Origin: ${input.originLabel || input.origin}` });
  return chips;
}

/** Orders the view would show with every filter cleared (withdrawn orders are never counted as demand). */
export function eligibleOrders(orders: readonly ProductionOrder[], opts: { keepCancellationNotices?: boolean } = {}): ProductionOrder[] {
  return orders.filter((order) => !isCpuWithdrawn(order) || (opts.keepCancellationNotices && Boolean(order.cancellationNotice)));
}

export type ViewState = "loading" | "error" | "verified-empty" | "filtered-empty" | "ready";

/**
 * Distinguish "still loading", "load failed", "nothing is due" and "filters hide everything".
 * `eligibleCount` ignores status/origin/site filters; `shownCount` applies them.
 */
export function resolveViewState(input: { loading: boolean; error: string; eligibleCount: number; shownCount: number }): ViewState {
  if (input.error) return "error";
  if (input.loading) return "loading";
  if (input.shownCount > 0) return "ready";
  return input.eligibleCount > 0 ? "filtered-empty" : "verified-empty";
}

export function siteSelectionSummary(selected: readonly string[], options: readonly SiteOption[]): string {
  if (!selected.length) return options.length ? `All sites (${options.length})` : "All sites";
  const present = selected.filter((id) => options.some((option) => option.id === id)).length;
  return present === selected.length ? `${selected.length} of ${options.length} sites` : `${selected.length} selected (${present} in this view)`;
}
