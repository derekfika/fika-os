import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { aggregateProductionTotals } from "../lib/production-day";
import { loadProductionTotalsRange } from "../lib/cpu-totals-loader";
import { addOperationalDays, filterProductionTotalsOrders, filterProductionTotalsOrdersToDates, formatProductionTotalsDateRange, formatProductionTotalsSelection, operationalWeekRange, productionTotalsWeekDates, productionWeeksInRange, resolveProductionTotalsRange } from "../lib/production-totals-range";
import type { CpuWeekProjection } from "../lib/cpu-projection";

function order(id: string, serviceDate: string, itemName: string, quantity: number, unit = "portion", workstream: "delivered_in" | "sandwiches" | "hospitality" = "delivered_in"): ProductionOrder {
  return { canonicalId: id, entityType: "Production Order", schemaVersion: "projection", version: 1, requirementIds: [], sourceBookingId: id, sourceQuoteRevisionId: "projection", serviceDate, requiredBy: `${serviceDate}T12:00:00`, serviceWindow: { startTime: "12:00" }, status: "ready", priority: "normal", lines: [{ canonicalId: `${id}:line`, sourceBookingLineId: `${id}:line`, itemName, customerQuantity: quantity, customerUnit: unit, productionQuantity: quantity, productionUnit: unit, dietaries: {}, status: "ready", sortOrder: 0, workstream }], exceptions: [], origin: workstream === "delivered_in" ? "menu_planning" : "hospitality_booking", currentRevision: 1, createdAt: `${serviceDate}T00:00:00Z`, createdBy: "test", idempotencyKey: id, externalReferences: [], audit: [] };
}

function weekly(week: string, rows: Array<{ id: string; date: string; name: string; quantity: number; unit?: string; workstream?: string; origin?: string }>): CpuWeekProjection {
  return { serviceDate: week, weekCommencing: week, revision: 1, lastChangeSequence: 7, rebuiltAt: `${week}T00:00:00Z`, summary: { orders: rows.length, ready: rows.length, attention: 0, planned: 0, totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0) }, orders: rows.map(row => ({ id: row.id, serviceDate: row.date, requiredBy: `${row.date}T12:00:00`, serviceWindow: { startTime: "12:00" }, origin: row.origin || "menu_planning", sourceReference: row.id, priority: "normal", status: "ready", productionScope: row.workstream || "delivered_in", quantities: [{ sourceLineId: `${row.id}:line`, name: row.name, quantity: row.quantity, unit: row.unit || "portion", dietaries: {} }], allergenReadiness: "ready", planningReadiness: "ready", attention: [], version: 1 })) } as CpuWeekProjection;
}

function response(projection: CpuWeekProjection, ok = true) {
  return { ok, json: async () => ({ projection, package: { sourceVersion: `cpu-change-${projection.lastChangeSequence}`, contentHash: "a".repeat(64) } }) };
}

test("totals presets use inclusive London operational dates and Monday to Sunday weeks across year boundaries", () => {
  assert.deepEqual(resolveProductionTotalsRange("today", "2026-12-31").range, { from: "2026-12-31", to: "2026-12-31" });
  assert.deepEqual(resolveProductionTotalsRange("tomorrow", "2026-12-31").range, { from: "2027-01-01", to: "2027-01-01" });
  assert.deepEqual(resolveProductionTotalsRange("this_week", "2026-10-25").range, { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(resolveProductionTotalsRange("next_week", "2026-10-25").range, { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(operationalWeekRange("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
  assert.equal(addOperationalDays("2026-10-24", 1), "2026-10-25");
});

test("custom range is inclusive and bounded to 31 days", () => {
  assert.deepEqual(resolveProductionTotalsRange("custom", "2026-10-23", "2026-10-26", "2026-10-27").range, { from: "2026-10-26", to: "2026-10-27" });
  assert.deepEqual(resolveProductionTotalsRange("custom", "2026-10-23", "2026-10-26", "2026-10-26").range, { from: "2026-10-26", to: "2026-10-26" });
  assert.match(resolveProductionTotalsRange("custom", "2026-10-23", "", "2026-10-27").error || "", /both a valid From and To date/);
  assert.match(resolveProductionTotalsRange("custom", "2026-10-23", "2026-10-26", "").error || "", /both a valid From and To date/);
  assert.match(resolveProductionTotalsRange("custom", "2026-10-23", "2026-10-27", "2026-10-26").error || "", /on or before/);
  assert.equal(formatProductionTotalsDateRange({ from: "2026-10-26", to: "2026-10-27" }), "Monday, 26 October 2026 – Tuesday, 27 October 2026");
  assert.deepEqual(resolveProductionTotalsRange("custom", "2026-01-01", "2026-01-01", "2026-01-31").range, { from: "2026-01-01", to: "2026-01-31" });
  assert.match(resolveProductionTotalsRange("custom", "2026-01-01", "2026-01-01", "2026-02-01").error || "", /31 days/);
  assert.match(resolveProductionTotalsRange("custom", "2026-01-01", "2026-02-01", "2026-01-01").error || "", /on or before/);
  assert.deepEqual(productionWeeksInRange({ from: "2026-10-24", to: "2026-10-26" }), ["2026-10-19", "2026-10-26"]);
});

test("weekly range loads weekend orders across projections, clips boundaries and deduplicates canonical orders", async () => {
  const first = weekly("2026-10-19", [
    { id: "order:sat", date: "2026-10-24", name: "Fruit", quantity: 8, unit: "piece" },
    { id: "order:duplicate", date: "2026-10-25", name: "Bread", quantity: 4 },
    { id: "order:outside", date: "2026-10-19", name: "Outside", quantity: 50 },
  ]);
  const second = weekly("2026-10-26", [
    { id: "order:sun", date: "2026-11-01", name: "Fruit", quantity: 3, unit: "piece" },
    { id: "order:duplicate", date: "2026-10-25", name: "Bread", quantity: 4 },
  ]);
  const requested: string[] = [];
  const result = await loadProductionTotalsRange({ from: "2026-10-20", to: "2026-11-01" }, "all", async week => {
    requested.push(week);
    return response(week === "2026-10-19" ? first : second);
  });
  assert.deepEqual(requested.sort(), ["2026-10-19", "2026-10-26"]);
  assert.deepEqual(result.orders.map(row => row.canonicalId).sort(), ["order:duplicate", "order:sat", "order:sun"]);
  const totals = aggregateProductionTotals(result.orders).flatMap(category => category.items.map(item => [item.name, item.quantity, item.unit]));
  assert.deepEqual(totals, [["Bread", 4, "portion"], ["Fruit", 11, "piece"]]);
});

test("totals aggregate multiple sites while keeping workstreams, units and duplicate line identities separate", () => {
  const a = order("order:a", "2026-10-26", "Apple tart", 4, "tray", "hospitality");
  const b = { ...order("order:b", "2026-10-27", "Apple tart", 6, "tray", "hospitality"), destinationOplocId: "site:other" };
  const otherUnit = order("order:c", "2026-10-27", "Apple tart", 3, "portion", "hospitality");
  const repeatedLine = { ...a.lines[0], canonicalId: a.lines[0].canonicalId };
  const withRepeatedLine = { ...a, lines: [a.lines[0], repeatedLine] };
  const totals = aggregateProductionTotals([withRepeatedLine, a, b, otherUnit]);
  assert.deepEqual(totals[0].items.map(item => [item.name, item.quantity, item.unit]), [["Apple tart", 3, "portion"], ["Apple tart", 10, "tray"]]);
  assert.equal(filterProductionTotalsOrders([a, b, otherUnit], { from: "2026-10-26", to: "2026-10-27" }, "site:other").length, 1);
});

test("selected totals days recalculate from a verified week without changing its canonical deduplication", () => {
  const week = [
    order("order:mon", "2026-10-19", "Soup", 10),
    order("order:tue", "2026-10-20", "Soup", 20),
    order("order:fri", "2026-10-23", "Soup", 50),
    order("order:sat", "2026-10-24", "Soup", 60),
    order("order:sun", "2026-10-25", "Soup", 70),
    order("order:next-week", "2026-10-26", "Soup", 100),
  ];
  const verifiedWeek = filterProductionTotalsOrders(week, operationalWeekRange("2026-10-19"));
  const singleDay = filterProductionTotalsOrdersToDates(verifiedWeek, ["2026-10-20"]);
  const weekdays = filterProductionTotalsOrdersToDates(verifiedWeek, productionTotalsWeekDates("2026-10-19").slice(0, 5));
  const multipleDays = filterProductionTotalsOrdersToDates(verifiedWeek, ["2026-10-20", "2026-10-24"]);
  const allDays = filterProductionTotalsOrdersToDates(verifiedWeek, productionTotalsWeekDates("2026-10-19"));
  assert.equal(weekdays.length, 3);
  assert.equal(aggregateProductionTotals(weekdays)[0].items[0].quantity, 80);
  assert.equal(singleDay.length, 1);
  assert.equal(aggregateProductionTotals(singleDay)[0].items[0].quantity, 20);
  assert.equal(multipleDays.length, 2);
  assert.equal(aggregateProductionTotals(multipleDays)[0].items[0].quantity, 80);
  assert.equal(allDays.length, 5);
  assert.equal(aggregateProductionTotals(allDays)[0].items[0].quantity, 210);
  assert.equal(filterProductionTotalsOrdersToDates(verifiedWeek, []).length, 0);
  assert.equal(formatProductionTotalsSelection("2026-10-19", [0, 1, 2, 3, 4]), "Weekdays · Mon 19 Oct – Fri 23 Oct");
  assert.equal(formatProductionTotalsSelection("2026-10-19", [0, 1, 2, 3, 4, 5, 6]), "All days · Mon 19 Oct – Sun 25 Oct");
  assert.equal(formatProductionTotalsSelection("2026-10-19", []), "No days selected");
});

test("selected-day filtering runs after canonical version selection and preserves site and origin filters", () => {
  const older = order("order:changed", "2026-10-19", "Soup", 10);
  const newer = { ...order("order:changed", "2026-10-20", "Soup", 14), version: 2 };
  const hospitality = order("order:hospitality", "2026-10-20", "Tart", 3, "tray", "hospitality");
  const siteOrder = { ...order("order:site", "2026-10-20", "Tart", 8, "tray", "hospitality"), destinationOplocId: "site:other" };
  const selectedWeek = filterProductionTotalsOrders([older, newer, hospitality, siteOrder], operationalWeekRange("2026-10-19"));
  assert.equal(filterProductionTotalsOrdersToDates(selectedWeek, ["2026-10-19"]).some(row => row.canonicalId === "order:changed"), false);
  assert.equal(filterProductionTotalsOrdersToDates(selectedWeek, ["2026-10-20"]).find(row => row.canonicalId === "order:changed")?.version, 2);
  assert.deepEqual(filterProductionTotalsOrders(selectedWeek, operationalWeekRange("2026-10-19"), "", "hospitality_booking").map(row => row.canonicalId).sort(), ["order:hospitality", "order:site"]);
  assert.deepEqual(filterProductionTotalsOrders(selectedWeek, operationalWeekRange("2026-10-19"), "site:other").map(row => row.canonicalId), ["order:site"]);
});

test("a newer cancellation removes the older active order from production totals", () => {
  const earlier = order("order:withdrawn", "2026-10-20", "Meal", 12);
  const withdrawn = { ...earlier, version: 2, status: "cancelled" as const, cancellationNotice: "Synthetic cancellation" };
  assert.deepEqual(filterProductionTotalsOrders([earlier, withdrawn], operationalWeekRange("2026-10-19")), []);
});

test("failed projection freshness does not become an empty successful totals result; stale requests are discarded", async () => {
  const projection = weekly("2026-10-19", [{ id: "order:a", date: "2026-10-20", name: "Dish", quantity: 1 }]);
  await assert.rejects(loadProductionTotalsRange({ from: "2026-10-20", to: "2026-10-20" }, "all", async () => response(projection, false)), /Current production totals could not be verified/);
  const stale = await loadProductionTotalsRange({ from: "2026-10-20", to: "2026-10-20" }, "all", async () => response(projection), () => false);
  assert.deepEqual(stale, { status: "stale", orders: [] });
});

test("a valid projection with no work for an empty week returns a verified empty result", async () => {
  const emptyWeek = weekly("2026-10-19", []);
  const result = await loadProductionTotalsRange({ from: "2026-10-25", to: "2026-10-25" }, "all", async () => response(emptyWeek));
  assert.deepEqual(result, { status: "current", orders: [] });
});

test("Totals and Run Sheet share week navigation and accessible day controls", async () => {
  const page = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8"));
  const css = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/totals.css", import.meta.url), "utf8"));
  const controls = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/ui/ProductionWeekControls.tsx", import.meta.url), "utf8"));
  assert.match(page, /<table className="cpu-total-list">/);
  assert.match(page, /Loading and verifying production totals/);
  assert.match(page, /role="alert">\{rangeError \|\| loadError\}/);
  assert.match(page, /Production view/);
  assert.match(controls, /aria-label="Previous week"/);
  assert.match(controls, /All days/);
  assert.match(page, /ProductionWeekNavigation weekCommencing=\{weekCommencing\} onWeekChange=\{chooseTotalsWeek\}/);
  assert.match(page, /view === "run-sheet" \? <>[\s\S]*?ProductionWeekNavigation weekCommencing=\{weekCommencing\} onWeekChange=\{chooseRunSheetWeek\}/);
  assert.match(page, /ProductionWeekDays weekCommencing=\{weekCommencing\} selectedDays=\{totalsSelectedDays\}/);
  assert.match(page, /selectedSiteIds=\{sites\}/);
  assert.match(page, /filterProductionTotalsOrdersToDates\(filterProductionTotalsOrders/);
  assert.match(page, /No production days selected[\s\S]*?Select one or more days above/);
  assert.doesNotMatch(page, /\[view, date, dayDate, weekCommencing, productionScope, todayKey, totalsCustomRange, customFrom, customTo, totalsSelectedDays\]/);
  assert.doesNotMatch(page, /onClick=\{\(\) => \{[^}]*fetch\(/);
  assert.doesNotMatch(page, /cpu-total-card-grid|fika-cpu-total-progress/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /min-height: 44px/);
});
