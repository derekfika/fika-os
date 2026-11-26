import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { filterProductionOrdersForScope } from "../lib/production-scope";
import { filterProductionTotalsOrders } from "../lib/production-totals-range";
import { summarizeTotalsPax } from "../app/ui/totals-pax";

const day = "2026-11-23";

function order(id: string, options: Partial<ProductionOrder> = {}): ProductionOrder {
  const origin = options.origin || "menu_planning";
  return {
    canonicalId: id,
    entityType: "Production Order",
    schemaVersion: "projection",
    version: 1,
    requirementIds: [],
    sourceBookingId: id,
    sourceQuoteRevisionId: `quote:${id}`,
    sourceMenuId: options.sourceMenuId,
    menuName: options.menuName,
    serviceType: options.serviceType,
    destinationOplocId: options.destinationOplocId ?? "oploc:a",
    destinationLabel: options.destinationLabel ?? "Site A",
    serviceDate: options.serviceDate ?? day,
    requiredBy: `${options.serviceDate ?? day}T12:00:00Z`,
    serviceWindow: { startTime: "12:00" },
    status: "ready",
    priority: "normal",
    guestCount: options.guestCount,
    productionCategory: options.productionCategory ?? (origin === "menu_planning" ? "delivered_in" : "hospitality"),
    lines: options.lines ?? [{ canonicalId: `${id}:line`, sourceBookingLineId: `${id}:line`, itemName: "Soup", customerQuantity: 60, customerUnit: "portions", productionQuantity: 60, productionUnit: "portions", workstream: origin === "hospitality_booking" ? "hospitality" : "delivered_in", dietaries: {}, status: "ready", sortOrder: 0 }],
    exceptions: [],
    origin,
    currentRevision: 1,
    createdAt: `${options.serviceDate ?? day}T00:00:00Z`,
    createdBy: "test",
    idempotencyKey: id,
    externalReferences: [],
    audit: [],
    ...options,
  } as ProductionOrder;
}

test("Totals PAX counts once per canonical service and selected date, not per dish line", () => {
  const breakfast = order("breakfast", { sourceMenuId: "menu:breakfast", serviceType: "Breakfast", guestCount: 40, lines: [
    { canonicalId: "breakfast:1", sourceBookingLineId: "breakfast:1", itemName: "Soup", customerQuantity: 60, customerUnit: "portions", dietaries: {} },
    { canonicalId: "breakfast:2", sourceBookingLineId: "breakfast:2", itemName: "Fruit", customerQuantity: 12, customerUnit: "portions", dietaries: {} },
  ] as ProductionOrder["lines"] });
  const lunch = order("lunch", { sourceMenuId: "menu:lunch", serviceType: "Lunch", guestCount: 55 });
  const nextDay = order("next-day", { serviceDate: "2026-11-24", sourceMenuId: "menu:lunch", guestCount: 10 });
  const summary = summarizeTotalsPax([breakfast, lunch, nextDay]);
  assert.equal(summary.serviceCount, 3);
  assert.equal(summary.recordedServices, 3);
  assert.equal(summary.totalPax, 105);
  assert.deepEqual(summary.sites.map(({ label, recordedPax }) => [label, recordedPax]), [["Site A", 105]]);
});

test("Totals PAX deduplicates repeated canonical site/service records and marks conflicts unrecorded", () => {
  const first = order("first", { sourceMenuId: "menu:one", guestCount: 31 });
  const duplicate = order("duplicate", { sourceMenuId: "menu:one", guestCount: 31 });
  const sameServiceMissing = order("missing-duplicate", { sourceMenuId: "menu:one", guestCount: undefined });
  const summary = summarizeTotalsPax([first, duplicate]);
  assert.equal(summary.serviceCount, 1);
  assert.equal(summary.totalPax, 31);

  const conflicted = summarizeTotalsPax([first, sameServiceMissing]);
  assert.equal(conflicted.totalPax, undefined);
  assert.equal(conflicted.incomplete, true);
  assert.equal(conflicted.sites[0].recordedServices, 0);
  assert.equal(conflicted.sites[0].unrecordedServices, 1);
});

test("missing, zero and unsupported PAX stay unrecorded rather than becoming zero", () => {
  const missing = order("missing", { guestCount: undefined });
  const zero = order("zero", { sourceMenuId: "menu:zero", guestCount: 0 });
  const unsupported = order("unsupported", { origin: "cpu_created", sourceMenuId: undefined, guestCount: 77 });
  const summary = summarizeTotalsPax([missing, zero, unsupported]);
  assert.equal(summary.totalPax, undefined);
  assert.equal(summary.incomplete, true);
  assert.equal(summary.unrecordedServices, 3);
  assert.equal(summary.sites[0].recordedPax, 0);
});

test("Totals PAX respects selected service dates, production scope and OPLOC filters", () => {
  const selectedSite = order("site-a", { guestCount: 35, destinationOplocId: "oploc:a", destinationLabel: "Site A" });
  const otherSite = order("site-b", { guestCount: 55, destinationOplocId: "oploc:b", destinationLabel: "Site B" });
  const otherDate = order("other-date", { guestCount: 80, serviceDate: "2026-11-24", destinationOplocId: "oploc:a" });
  const hospitality = order("hospitality", { origin: "hospitality_booking", guestCount: 90, destinationOplocId: "oploc:a" });
  const scoped = filterProductionOrdersForScope([selectedSite, otherSite, otherDate, hospitality], "delivered_in", {});
  const filtered = filterProductionTotalsOrders(scoped, { from: day, to: day }, ["oploc:a"]);
  const summary = summarizeTotalsPax(filtered);
  assert.deepEqual(filtered.map(({ canonicalId }) => canonicalId), ["site-a"]);
  assert.equal(summary.totalPax, 35);
  assert.deepEqual(summary.sites.map(({ key }) => key), ["oploc:oploc:a"]);
});
