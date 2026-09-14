import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveredInDayProjection } from "../lib/delivered-in-projection-materialiser";
import type { ProjectedDay } from "../lib/projection";

const day: ProjectedDay = {
  publicationId: "publication:1",
  publicationDayId: "publication-day:1",
  sourceDayId: "source-day:1",
  date: "2026-09-14",
  dayName: "Monday",
  version: 1,
  contentHash: "menu-day-hash",
  entries: [{ sourceEntryId: "entry:1", canonicalDishId: "dish:1", slot: "SALAD 1", dishName: "House salad", quantity: 10, allergens: { milk: "contains" } }],
  allergenSignoff: {},
};
const request = { headers: new Headers() } as never;
const site = { oplocId: "oploc:1", label: "Site One" };

test("published Menu Planning day remains visible without a CPU packet", async () => {
  const projection = await buildDeliveredInDayProjection({ request, site, day, governed: true, loadReview: async () => undefined });
  assert.equal(projection.entries[0].quantity, 10);
  assert.equal(projection.entries[0].allergens.milk, "unrecorded");
  assert.equal(projection.entries[0].allergensVisible, false);
  assert.equal(projection.state.menu, "present");
  assert.equal(projection.state.cpu, "unavailable");
  assert.equal(projection.state.completeness, "complete");
  assert.equal(projection.state.exceptions[0].code, "CPU_REVIEW_UNAVAILABLE");
});

test("pending or unsigned CPU review does not suppress the operational menu", async () => {
  const projection = await buildDeliveredInDayProjection({ request, site, day, governed: true, loadReview: async () => ({ entries: new Map(), cpuReview: { status: "pending", signatures: [] }, orderIds: [] }) });
  assert.equal(projection.entries.length, 1);
  assert.equal(projection.entries[0].allergensVisible, false);
  assert.equal(projection.state.exceptions[0].code, "CPU_REVIEW_UNSIGNED");
});

test("a valid signed CPU review overlays allergens on the same Menu Planning projection", async () => {
  const projection = await buildDeliveredInDayProjection({ request, site, day, governed: true, loadReview: async () => ({ entries: new Map([["dish:1", { allergens: { milk: "contains" as const }, allergenState: "contains" as const }]]), cpuReview: { status: "signed", signatures: [{ role: "chef", printedName: "Chef", signedAt: "2026-09-14T08:00:00Z" }], drivePdfUrl: "https://example.test/signed.pdf" }, orderIds: ["order:1"], package: { sourceBundleHash: "menu-day-hash", sourceStatus: "current", sourceCompleteness: "complete" } }) });
  assert.equal(projection.entries[0].allergens.milk, "contains");
  assert.equal(projection.entries[0].allergensVisible, true);
  assert.equal(projection.drivePdfUrl, "https://example.test/signed.pdf");
  assert.equal(projection.sourceLineage.menu.contentHash, "menu-day-hash");
  assert.equal(projection.state.cpu, "present");
});

test("a missing CPU dish fails allergen enrichment closed but preserves the published menu", async () => {
  const projection = await buildDeliveredInDayProjection({ request, site, day, governed: true, loadReview: async () => ({ entries: new Map(), cpuReview: { status: "signed", signatures: [] }, orderIds: [] }) });
  assert.equal(projection.entries[0].quantity, 10);
  assert.equal(projection.entries[0].allergens.milk, "unrecorded");
  assert.equal(projection.entries[0].allergensVisible, false);
  assert.equal(projection.state.exceptions[0].code, "CPU_PACKET_MISSING_DISH");
});
