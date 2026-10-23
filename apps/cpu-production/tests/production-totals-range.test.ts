import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { aggregateProductionTotals } from "../lib/production-day";
import { loadProductionTotalsRange } from "../lib/cpu-totals-loader";
import { addOperationalDays, filterProductionTotalsOrders, formatProductionTotalsDateRange, operationalWeekRange, productionWeeksInRange, resolveProductionTotalsRange } from "../lib/production-totals-range";
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

test("Totals uses a semantic responsive read-only table and exposes loading/failure states", async () => {
  const page = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8"));
  const css = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/totals.css", import.meta.url), "utf8"));
  assert.match(page, /<table className="cpu-total-list">/);
  assert.match(page, /Loading and verifying production totals/);
  assert.match(page, /role="alert">\{rangeError \|\| loadError\}/);
  assert.doesNotMatch(page, /cpu-total-card-grid|fika-cpu-total-progress/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(page, /aria-label="From date" type="date"[^>]*onInput=/);
  assert.match(page, /aria-label="To date" type="date"[^>]*onInput=/);
});
