import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { aggregateProductionTotals, orderDate } from "../lib/production-day";
import { filterProductionTotalsOrders, filterProductionTotalsOrdersToDates } from "../lib/production-totals-range";
import {
  activeFilterChips,
  buildSiteOptions,
  eligibleOrders,
  filterOrdersBySites,
  orderMatchesSites,
  resolveViewState,
  searchSiteOptions,
  selectShown,
  siteSelectionSummary,
  toggleSite,
  unscopedOrderCount,
} from "../lib/production-view-filters";

function order(id: string, over: Partial<ProductionOrder> & { qty?: number; unit?: string; item?: string } = {}): ProductionOrder {
  return {
    canonicalId: id,
    entityType: "Production Order",
    schemaVersion: "1",
    version: over.version ?? 1,
    requirementIds: [],
    sourceBookingId: id,
    sourceQuoteRevisionId: "q",
    destinationOplocId: "destinationOplocId" in over ? over.destinationOplocId : "oploc:a",
    destinationLabel: over.destinationLabel ?? "Site A",
    serviceDate: over.serviceDate ?? "2026-11-02",
    requiredBy: "2026-11-02T09:00:00Z",
    serviceWindow: { startTime: "09:00" },
    status: over.status ?? "accepted",
    workflowStatus: over.workflowStatus,
    priority: "normal",
    lines: [{ canonicalId: `${id}-l1`, sourceBookingLineId: `${id}-b1`, itemName: over.item ?? "Sandwich", customerQuantity: over.qty ?? 10, customerUnit: over.unit ?? "portion", dietaries: {} } as ProductionOrder["lines"][number]],
    exceptions: [],
    origin: over.origin ?? "menu_planning",
    currentRevision: 1,
    createdAt: "2026-10-30T00:00:00Z",
    createdBy: "test",
    idempotencyKey: id,
    externalReferences: [],
    audit: [],
    supersededBy: over.supersededBy,
    cancellationNotice: over.cancellationNotice,
  } as ProductionOrder;
}

const sample = [
  order("o1", { destinationOplocId: "oploc:a", destinationLabel: "Level 5" }),
  order("o2", { destinationOplocId: "oploc:b", destinationLabel: "Level 2" }),
  order("o3", { destinationOplocId: "oploc:b", destinationLabel: "Level 2" }),
  order("o4", { destinationOplocId: "oploc:c", destinationLabel: "Level 2" }),
  order("o5", { destinationOplocId: undefined, destinationLabel: "One-off lobby" }),
];

test("site options use canonical OPLOC IDs, count distinct orders and keep same-label sites separate", () => {
  const options = buildSiteOptions(sample);
  assert.deepEqual(options.map((o) => [o.id, o.count]), [["oploc:b", 2], ["oploc:c", 1], ["oploc:a", 1]]);
  assert.equal(options.filter((o) => o.label === options[0].label).length, 2, "two sites share a label but not an identity");
  assert.ok(!options.some((o) => !o.id), "one-off destinations never become options");
  const dup = buildSiteOptions([order("x"), order("x")]);
  assert.equal(dup[0].count, 1, "the same canonical order counts once");
});

test("site search ignores case, accents and spacing and keeps IDs untouched", () => {
  const options = [{ id: "oploc:1", label: "Münich Re · Level 5", count: 1 }, { id: "oploc:2", label: "Gallagher", count: 2 }];
  assert.deepEqual(searchSiteOptions(options, "  MUNICH   level").map((o) => o.id), ["oploc:1"]);
  assert.deepEqual(searchSiteOptions(options, "").map((o) => o.id), ["oploc:1", "oploc:2"]);
  assert.deepEqual(searchSiteOptions(options, "nothing"), []);
});

test("an empty selection is every site; a selection matches canonical IDs only", () => {
  assert.equal(filterOrdersBySites(sample, []).length, 5);
  assert.deepEqual(filterOrdersBySites(sample, ["oploc:b"]).map((o) => o.canonicalId), ["o2", "o3"]);
  assert.deepEqual(filterOrdersBySites(sample, ["oploc:a", "oploc:c"]).map((o) => o.canonicalId), ["o1", "o4"]);
  assert.equal(orderMatchesSites({ destinationOplocId: undefined }, ["oploc:a"]), false, "no OPLOC never matches a selection");
  assert.equal(orderMatchesSites({ destinationOplocId: "Level 2" }, ["oploc:b"]), false, "a display label is not an identity");
});

test("orders without an OPLOC are disclosed, not given an invented identity", () => {
  assert.equal(unscopedOrderCount(sample), 1);
  assert.equal(unscopedOrderCount([order("a"), order("a", { destinationOplocId: undefined })]), 1);
  assert.deepEqual(filterOrdersBySites(sample, ["oploc:a"]).map((o) => o.destinationOplocId), ["oploc:a"]);
});

test("select all shown adds only the searched options, clear and toggle behave", () => {
  const options = buildSiteOptions(sample);
  assert.deepEqual(selectShown(["oploc:a"], searchSiteOptions(options, "level 2")), ["oploc:a", "oploc:b", "oploc:c"]);
  assert.deepEqual(selectShown(["oploc:a"], []), ["oploc:a"]);
  assert.deepEqual(toggleSite(["oploc:a"], "oploc:b"), ["oploc:a", "oploc:b"]);
  assert.deepEqual(toggleSite(["oploc:a", "oploc:b"], "oploc:a"), ["oploc:b"]);
});

test("selection summaries distinguish all sites, a subset and sites absent from the current view", () => {
  const options = buildSiteOptions(sample);
  assert.equal(siteSelectionSummary([], options), "All sites (3)");
  assert.equal(siteSelectionSummary(["oploc:a", "oploc:b"], options), "2 of 3 sites");
  assert.equal(siteSelectionSummary(["oploc:a", "oploc:zzz"], options), "2 selected (1 in this view)");
  assert.equal(siteSelectionSummary([], []), "All sites");
});

test("active filter chips list sites, status and origin so no filter is hidden", () => {
  const labels = new Map([["oploc:a", "Level 5"]]);
  const chips = activeFilterChips({ sites: ["oploc:a", "oploc:gone"], siteLabels: labels, status: "accepted", statusLabel: "Accepted", origin: "hospitality_booking", originLabel: "Hospitality booking" });
  assert.deepEqual(chips.map((c) => c.label), ["Site: Level 5", "Site: Site not in this view", "Status: Accepted", "Origin: Hospitality booking"]);
  assert.deepEqual(activeFilterChips({ sites: [], siteLabels: labels }), []);
});

test("view states separate loading, error, verified empty and filter-no-match", () => {
  const base = { loading: false, error: "", eligibleCount: 5, shownCount: 2 };
  assert.equal(resolveViewState(base), "ready");
  assert.equal(resolveViewState({ ...base, loading: true, shownCount: 0 }), "loading");
  assert.equal(resolveViewState({ ...base, error: "boom", loading: true }), "error");
  assert.equal(resolveViewState({ ...base, shownCount: 0 }), "filtered-empty");
  assert.equal(resolveViewState({ ...base, eligibleCount: 0, shownCount: 0 }), "verified-empty");
  assert.equal(resolveViewState({ ...base, loading: true, eligibleCount: 0, shownCount: 0 }), "loading");
});

test("withdrawn, cancelled and superseded orders are never eligible demand; notices are opt-in", () => {
  const cancelled = order("c1", { status: "cancelled" as ProductionOrder["status"], cancellationNotice: "Booking cancelled" });
  const workflowCancelled = order("c2", { workflowStatus: "cancelled" as ProductionOrder["status"] });
  const superseded = order("c3", { supersededBy: "o9" });
  const all = [order("live"), cancelled, workflowCancelled, superseded];
  assert.deepEqual(eligibleOrders(all).map((o) => o.canonicalId), ["live"]);
  assert.deepEqual(eligibleOrders(all, { keepCancellationNotices: true }).map((o) => o.canonicalId), ["live", "c1"]);
});

test("totals: the same selected sites give the same orders whether one id or several are passed, with old string callers unchanged", () => {
  const range = { from: "2026-11-02", to: "2026-11-06" };
  assert.deepEqual(filterProductionTotalsOrders(sample, range, "oploc:b").map((o) => o.canonicalId), ["o2", "o3"]);
  assert.deepEqual(filterProductionTotalsOrders(sample, range, ["oploc:b"]).map((o) => o.canonicalId), ["o2", "o3"]);
  assert.deepEqual(filterProductionTotalsOrders(sample, range, ["oploc:a", "oploc:c"]).map((o) => o.canonicalId), ["o1", "o4"]);
  assert.equal(filterProductionTotalsOrders(sample, range, []).length, 5);
  assert.equal(filterProductionTotalsOrders(sample, range, "").length, 5);
  assert.deepEqual(filterProductionTotalsOrders(sample, range, ["oploc:a"], "grab_and_go"), []);
});

test("totals: selected-site quantities plus the other sites equal the all-site total, with units kept separate", () => {
  const orders = [
    order("t1", { destinationOplocId: "oploc:a", qty: 10, unit: "portion", item: "Soup" }),
    order("t2", { destinationOplocId: "oploc:b", qty: 6, unit: "portion", item: "Soup" }),
    order("t3", { destinationOplocId: "oploc:b", qty: 4, unit: "tray", item: "Soup" }),
    order("t4", { destinationOplocId: undefined, qty: 5, unit: "portion", item: "Soup" }),
  ];
  const range = { from: "2026-11-02", to: "2026-11-02" };
  const total = (list: ProductionOrder[]) => aggregateProductionTotals(list).flatMap((category) => category.items).map((item) => `${item.unit}:${item.quantity}`).sort();
  const everything = total(filterProductionTotalsOrders(orders, range, []));
  assert.deepEqual(everything, ["portion:21", "tray:4"].sort());
  assert.deepEqual(total(filterProductionTotalsOrders(orders, range, ["oploc:b"])), ["portion:6", "tray:4"].sort());
  assert.deepEqual(total(filterProductionTotalsOrders(orders, range, ["oploc:a"])), ["portion:10"]);
});

test("totals: superseded and cancelled versions never enter a site's total and the newest version wins", () => {
  const range = { from: "2026-11-02", to: "2026-11-02" };
  const v1 = order("dup", { version: 1, qty: 3 });
  const v2 = order("dup", { version: 2, qty: 8 });
  const gone = order("gone", { supersededBy: "dup", qty: 100 });
  const result = filterProductionTotalsOrders([v1, v2, gone], range, ["oploc:a"]);
  assert.deepEqual(result.map((o) => [o.canonicalId, o.version]), [["dup", 2]]);
});

test("totals: date boundaries are inclusive Europe/London business dates, never UTC slices", () => {
  const range = { from: "2026-03-29", to: "2026-03-30" };
  const lateBst = order("late", { serviceDate: "2026-03-29" });
  const early = order("early", { serviceDate: "2026-03-30" });
  const outside = order("outside", { serviceDate: "2026-03-31" });
  assert.deepEqual(filterProductionTotalsOrders([lateBst, early, outside], range, []).map((o) => o.canonicalId).sort(), ["early", "late"]);
  assert.deepEqual(filterProductionTotalsOrdersToDates(filterProductionTotalsOrders([lateBst, early], range, []), ["2026-03-30"]).map((o) => o.canonicalId), ["early"]);
  assert.equal(orderDate(early), "2026-03-30");
});

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const calendarRoute = readFileSync(new URL("../app/calendar/page.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("../app/ui/ProductionSiteFilter.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/ui/ProductionSiteFilter.module.css", import.meta.url), "utf8");

test("every view shares the one site selection and summary, and the old single select is gone", () => {
  assert.match(page, /<ProductionSiteFilter options=\{siteOptions\} selected=\{sites\} onChange=\{setSites\}/);
  assert.match(page, /<ProductionFilterSummary/);
  assert.match(page, /\["calendar", "day", "queue", "run-sheet", "totals"\]\.includes\(view\)/);
  assert.match(page, /filterOrdersBySites\(allSitesBase, sites\)/);
  assert.match(page, /filterProductionTotalsOrders\(orders, totalsRange, siteIds, origin\)/);
  assert.doesNotMatch(page, /<select[^>]*setSite/, "no single-site select remains");
  assert.match(calendarRoute, /ProductionSiteFilter/);
  assert.match(calendarRoute, /filterOrdersBySites\(orders, sites\)/);
});

test("filtering never mutates orders or touches printing, eligibility or handoffs", () => {
  for (const file of ["../lib/production-view-filters.ts", "../app/ui/ProductionSiteFilter.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|method:\s*"(POST|PUT|PATCH|DELETE)"/);
  }
  assert.match(page, /printKitchenDocument\(totalsPrintHtml\(categoryTotals/, "totals print path is unchanged");
});

test("the site control is a labelled, keyboard operable group with counts and a reset", () => {
  assert.match(control, /aria-expanded=\{open\}/);
  assert.match(control, /role="group" aria-label="Filter by site"/);
  assert.match(control, /type="checkbox"/);
  assert.match(control, /Select all/);
  assert.match(control, />Clear</);
  assert.match(control, /event\.key === "Escape"/);
  assert.match(control, /role="status"/);
  assert.match(control, /Reset filters/);
  assert.match(control, /Remove filter/);
  assert.match(control, /Selected sites|for the selected sites/);
  assert.match(control, /without a site identity/);
});

test("the control meets touch, focus and tablet layout rules with semantic tokens", () => {
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no raw colours in touched UI");
});
