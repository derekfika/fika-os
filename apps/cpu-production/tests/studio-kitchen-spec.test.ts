import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionPrintHtml, dayProductionPrintHtml } from "../app/ui/day-production-print";
import { selectedRunSheetPrintManifestKey } from "../app/ui/run-sheet-printing";
import { loadWholeDay } from "../app/ui/whole-day-production";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { compareMonotonicProjectionWrite } from "../lib/cpu-projection-repository";
import { validatePackingOrder } from "../lib/packing-checklist";
import type { ProductionOrder } from "../lib/production-types";
import { studioKitchenSpecError } from "../lib/studio-kitchen-spec";
import { readStudioKitchenSpec, type StudioKitchenSpec } from "../../shared/hospitality-menu-studio-kitchen";

const day = "2026-11-24";
const bookingId = "booking:fixture";
const bookingLineId = "line:fixture";

const frozenSpec = (): StudioKitchenSpec => ({
  version: 1,
  bookingId,
  bookingLineId,
  selections: [{
    selectionId: "choice:pastries",
    customerQuantity: 4,
    subject: { dishId: "dish:pastries", revision: 3, sourceHash: "a".repeat(64) },
    publication: { publicationId: "publication:autumn", publicationRevision: 5, contentHash: "b".repeat(64) },
    release: { releaseId: "release:pastries:3", matrixHash: "c".repeat(64) },
    name: "Mini Pastries & Muffins",
    kitchenDescription: "Pack by type.\n<script>Keep separate</script>",
    assortment: {
      boxCount: 4,
      unit: "pieces",
      expectedTotal: 24,
      components: [
        { id: "component:croissant", name: "Croissant <mini>", quantity: 8 },
        { id: "component:muffin", name: "Muffin", quantity: 16 },
      ],
    },
  }, {
    selectionId: "choice:salad",
    customerQuantity: 12,
    subject: { dishId: "dish:salad", revision: 7, sourceHash: "d".repeat(64) },
    publication: { publicationId: "publication:autumn", publicationRevision: 5, contentHash: "b".repeat(64) },
    release: { releaseId: "release:salad:7", matrixHash: "e".repeat(64) },
    name: "Salad",
    kitchenDescription: "Pack dressing separately.",
    assortment: null,
  }],
});

function order(spec?: ProductionOrder["lines"][number]["studioKitchenSpec"]): ProductionOrder {
  return {
    canonicalId: "order:fixture", entityType: "Production Order", schemaVersion: "0.1.0",
    sourceBookingId: bookingId, sourceQuoteRevisionId: "quote:fixture", requirementIds: [],
    serviceDate: day, requiredBy: day + "T12:00:00Z", serviceWindow: { startTime: "12:00" },
    destinationOplocId: "oploc:fixture", destinationLabel: "Fixture site",
    origin: "hospitality_booking", status: "accepted", priority: "normal", guestCount: 40,
    bookingNotes: "Customer booking note", kitchenNotes: "Booking kitchen note <check>",
    lines: [{
      canonicalId: "production-line:fixture", sourceBookingLineId: bookingLineId, itemName: "Working lunch",
      customerQuantity: 16, customerUnit: "portions", productionQuantity: 20, productionUnit: "portions",
      dietaries: {}, status: "pending", sortOrder: 0, workstream: "hospitality",
      ...(spec !== undefined ? { studioKitchenSpec: spec } : {}),
    }],
    exceptions: [], version: 2, currentRevision: 2, createdAt: day, createdBy: "test",
    idempotencyKey: "fixture", externalReferences: [], audit: [],
  };
}

async function wholeDay(source: ProductionOrder) {
  const projection = buildCpuDayProjection(day, [source]);
  const loaded = await loadWholeDay(day, async (url, init) => {
    assert.equal(url, `/api/production?projection=1&serviceDate=${day}&scope=all`);
    assert.equal(init?.cache, "no-store");
    return Response.json({ projection });
  });
  assert.equal(loaded.length, 1);
  return { projection, hydrated: loaded[0] };
}

test("frozen Studio selections survive CPU projection, whole-day loading and paper without changing operational units", async () => {
  const expected = frozenSpec();
  const source = frozenSpec();
  Object.assign(source.selections[0], { customerDescription: "Customer-safe copy stays separate" });
  const { projection, hydrated } = await wholeDay(order(source));
  // A new upstream revision cannot rewrite what the order and projection already froze.
  source.selections[0].subject.revision = 4;
  source.selections[0].assortment!.components[0].quantity = 1;
  const line = hydrated.lines[0];
  assert.deepEqual(projection.orders[0].quantities[0].studioKitchenSpec, expected);
  assert.deepEqual(line.studioKitchenSpec, expected);
  assert.equal(hydrated.guestCount, 40);
  assert.equal(line.customerQuantity, 16);
  assert.equal(line.productionQuantity, 20);
  assert.equal(projection.summary.totalUnits, 16);
  const html = dayProductionPrintHtml([hydrated], day);
  assert.match(html, /Customer ordered quantity/);
  assert.match(html, /16 portions/);
  assert.match(html, /Kitchen notes<\/strong><p>Booking kitchen note &lt;check&gt;/);
  assert.match(html, /Kitchen specification · Mini Pastries &amp; Muffins/);
  assert.match(html, /Dish version 3 · Menu publication 5/);
  assert.match(html, /Pack by type\.\n&lt;script&gt;Keep separate&lt;\/script&gt;/);
  assert.match(html, /4 boxes · 24 pieces per box · 96 pieces total/);
  assert.match(html, /Croissant &lt;mini&gt; · 8 pieces per box · 32 pieces total/);
  assert.match(html, /Muffin · 16 pieces per box · 64 pieces total/);
  assert.match(html, /Kitchen specification · Salad<\/strong><p>Dish version 7 · Menu publication 5<\/p><p class="studio-kitchen-description">Pack dressing separately\.<\/p><p class="studio-kitchen-total">Customer ordered quantity · 12 portions/);
  assert.doesNotMatch(html, /<script>|Customer-safe copy stays separate|Customer booking note/);
});

test("legacy lines still print with their existing quantities and notes", async () => {
  const { projection, hydrated } = await wholeDay(order());
  assert.equal(Object.hasOwn(projection.orders[0].quantities[0], "studioKitchenSpec"), false);
  assert.equal(Object.hasOwn(hydrated.lines[0], "studioKitchenSpec"), false);
  const html = collectionPrintHtml(hydrated);
  assert.match(html, /16 portions/);
  assert.match(html, /Kitchen notes/);
  assert.doesNotMatch(html, /Kitchen specification ·/);
  assert.doesNotThrow(() => validatePackingOrder(hydrated));
});

test("historical frozen dishes without an individual quantity still print without a derived amount", () => {
  const historical = frozenSpec();
  delete historical.selections[1].customerQuantity;
  const html = collectionPrintHtml(order(historical));
  assert.match(html, /Kitchen specification · Salad/);
  assert.doesNotMatch(html, /Customer ordered quantity ·/);
});

test("malformed frozen evidence is explicit and prevents packing or print of the affected collection", async () => {
  const corrupt = frozenSpec();
  corrupt.selections[0].assortment!.components[0].quantity = 7;
  const { projection, hydrated } = await wholeDay(order(corrupt));
  assert.equal(projection.orders[0].quantities[0].studioKitchenSpec, null);
  assert.ok(projection.orders[0].attention.includes(studioKitchenSpecError));
  assert.equal(projection.orders[0].planningReadiness, "attention");
  assert.equal(hydrated.lines[0].studioKitchenSpec, null);
  assert.throws(() => validatePackingOrder(hydrated), /frozen kitchen specification could not be verified/i);
  assert.throws(() => collectionPrintHtml(hydrated), /Nothing was printed/);
  assert.throws(() => dayProductionPrintHtml([hydrated], day), /Nothing was printed/);
});

test("invalid binding, source evidence, counts and arithmetic fail validation", () => {
  const cases: [string, (spec: StudioKitchenSpec) => unknown][] = [
    ["wrong booking", spec => spec.bookingId = "booking:other"],
    ["wrong line", spec => spec.bookingLineId = "line:other"],
    ["unknown contract version", spec => Object.assign(spec, { version: 2 })],
    ["duplicate selection", spec => spec.selections.push(spec.selections[0])],
    ["duplicate component", spec => spec.selections[0].assortment!.components[1].id = spec.selections[0].assortment!.components[0].id],
    ["unidentified release", spec => spec.selections[0].release.releaseId = ""],
    ["unidentified revision", spec => spec.selections[0].subject.revision = 0],
    ["invalid publication hash", spec => spec.selections[0].publication.contentHash = "invalid"],
    ["fractional box count", spec => spec.selections[0].assortment!.boxCount = 1.5],
    ["missing box count", spec => Object.assign(spec.selections[0].assortment!, { boxCount: undefined })],
    ["overflowing box count", spec => spec.selections[0].assortment!.boxCount = Number.MAX_SAFE_INTEGER],
    ["overflowing components", spec => spec.selections[0].assortment!.components[1].quantity = Number.MAX_SAFE_INTEGER],
  ];
  for (const [label, mutate] of cases) {
    const spec = frozenSpec();
    mutate(spec);
    assert.equal(readStudioKitchenSpec(spec, bookingId, bookingLineId), undefined, label);
  }
});

test("print confirmation detects frozen evidence changes even when customer and production totals stay the same", () => {
  const source = frozenSpec();
  const key = (value: StudioKitchenSpec) =>
    selectedRunSheetPrintManifestKey(new Map([[day, [order(value)]]]), [day], ["oploc:oploc:fixture"]);
  const fresh = frozenSpec();
  fresh.selections[0].release.matrixHash = "f".repeat(64);
  assert.notEqual(key(source), key(fresh));
});

test("same-sequence replacement cannot change a frozen dish revision", () => {
  const source = frozenSpec();
  const fresh = frozenSpec();
  fresh.selections[0].subject.revision++;
  const current = buildCpuDayProjection(day, [order(source)], [], 9);
  const incoming = buildCpuDayProjection(day, [order(fresh)], [], 9);
  assert.throws(() => compareMonotonicProjectionWrite(current, incoming), /conflicting content/);
});
