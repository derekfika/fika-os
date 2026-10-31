import test from "node:test";

import assert from "node:assert/strict";

import {
  collectionOrders,
  collectionPrintHtml,
  totalsPrintHtml,
  collectionQuantity,
  collectionTime,
} from "../app/ui/kitchen-print";
import { eventGuestCountLabel, orderedQuantityLabel } from "../lib/ordered-quantity";

import { aggregateProductionTotals } from "../lib/production-day";

import type { ProductionOrder, ProductionLine } from "../lib/production-types";

const line = (id: string, quantity = 4, unit = "portions") =>
  ({
    canonicalId: id,
    itemName: "Dish " + id,
    customerQuantity: quantity,
    customerUnit: unit,
    sortOrder: 0,
    dietaries: {},
    status: "pending",
    sourceBookingLineId: id,
  }) as ProductionLine;

const order = (id: string, lines = [line("one")]) =>
  ({
    canonicalId: id,
    entityType: "Production Order",
    schemaVersion: "0.1.0",
    requirementIds: [],
    sourceBookingId: "booking:" + id,
    sourceQuoteRevisionId: "quote:" + id,
    priority: "normal",
    currentRevision: 1,
    createdAt: "2026-10-23T09:00:00Z",
    createdBy: "fixture",
    idempotencyKey: id,
    externalReferences: [],
    audit: [],
    version: 1,
    requiredBy: "2026-10-23T10:00:00Z",
    serviceDate: "2026-10-23",
    destinationLabel: "Test site",
    origin: "menu_planning",
    lines,
    exceptions: [],
    serviceWindow: { startTime: "11:00" },
    status: "ready",
    sourcePublicationDayId: "publication:friday",
    sourceVersion: 3,
  }) as ProductionOrder;

test("collection identity never joins distinct service orders at the same site/date and does not sort the caller array", () => {
  const a = order("a"),
    b = order("b");
  const input = [b, a, { ...a, version: 2 }];
  const result = collectionOrders(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].version, 2);
  assert.equal(input[0], b);
});

test("collection print has every long-list row, empty physical boxes, signatures, A4 and safe pagination", () => {
  const o = order(
    "a",
    Array.from({ length: 75 }, (_, i) => line(String(i))),
  );
  const html = collectionPrintHtml(o);
  assert.equal((html.match(/class="box"/g) || []).length, 75);
  assert.match(html, /Dish 74/);
  assert.match(html, /Packed by/);
  assert.match(html, /Checked by/);
  assert.match(html, /size:A4/);
  assert.match(html, /break-inside:avoid/);
  assert.match(html, /table-header-group/);
  assert.doesNotMatch(html, /checked=|<script/);
});

test("print escapes labels and omits internal recipe multipliers", () => {
  const o = order("a", [
    { ...line("x"), itemName: "<script>alert(1)</script>" },
  ]);
  assert.match(collectionPrintHtml(o), /&lt;script&gt;/);
  assert.doesNotMatch(collectionPrintHtml(o), /<script>/);
  assert.equal(collectionQuantity(line("x")), "4 portions");
  assert.equal(
    collectionQuantity({
      ...line("x"),
      productionQuantity: 12,
      productionUnit: "pieces",
    }),
    "4 portions",
  );
  assert.equal(
    collectionTime({
      ...o,
      serviceWindow: undefined,
      requiredBy: "2026-07-10T10:00:00Z",
    } as unknown as ProductionOrder),
    "11:00",
  );
});

test("customer ordered evidence stays primary across pax, event guests, mixed units and individual pieces", () => {
  const paxLine = { ...line("pax", 15, "pax"), productionQuantity: 45, productionUnit: "pieces" };
  const hospitalityOrder = { ...order("hospitality", [paxLine]), guestCount: 100 };
  const html = collectionPrintHtml(hospitalityOrder);
  assert.equal(collectionQuantity(paxLine), "15 pax");
  assert.equal(eventGuestCountLabel(hospitalityOrder.guestCount), "100");
  assert.match(html, /<strong>15 pax<\/strong>/);
  assert.doesNotMatch(html, /45 pieces|Prep:/);
  assert.doesNotMatch(html, />100</);

  assert.deepEqual(
    [line("person", 15, "Per person"), line("box", 2, "boxes"), line("tray", 3, "trays"), line("piece", 7, "pieces")]
      .map(orderedQuantityLabel),
    ["15 pax", "2 boxes", "3 trays", "7 pieces"],
  );
});

test("legacy lines without valid ordered quantity and unit require verification", () => {
  assert.equal(orderedQuantityLabel({ customerQuantity: undefined, customerUnit: "pax" } as unknown as ProductionLine), "Needs verification");
  assert.equal(orderedQuantityLabel({ customerQuantity: 15, customerUnit: " " } as ProductionLine), "Needs verification");
  assert.equal(collectionQuantity({ ...line("legacy"), customerQuantity: Number.NaN } as ProductionLine), "Needs verification");
  const html = collectionPrintHtml(order("legacy", [{ ...line("legacy"), customerUnit: "" } as ProductionLine]));
  assert.match(html, /Needs verification/);
  assert.doesNotMatch(html, /Prep: 45 pieces/);
});

test("daily and selected multi-day totals print reuse verified aggregation and never combine incompatible units", () => {
  const a = order("a", [line("same", 4), line("same-unit", 2, "boxes")]);
  a.lines[1].itemName = a.lines[0].itemName;
  const b = { ...order("b", [line("same", 6)]), serviceDate: "2026-10-26" };
  const daily = aggregateProductionTotals([a]);
  const weekly = aggregateProductionTotals([a, b]);
  assert.deepEqual(daily[0].items.map((x) => [x.quantity, x.unit]).sort(), [
    [2, "boxes"],
    [4, "portions"],
  ]);
  assert.deepEqual(weekly[0].items.map((x) => [x.quantity, x.unit]).sort(), [
    [10, "portions"],
    [2, "boxes"],
  ]);
  const html = totalsPrintHtml(
    weekly,
    "Fri + Mon",
    "Test site · Published menu · Delivered-In",
  );
  assert.match(html, />10<\/td>/);
  assert.match(html, /boxes/);
  assert.match(html, /Fri \+ Mon/);
  assert.match(html, /Test site/);
  assert.match(html, /Prep \/ order notes/);
  assert.deepEqual(aggregateProductionTotals([a]), daily);
});
