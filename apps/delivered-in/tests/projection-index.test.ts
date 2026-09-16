import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareDeliveredInProjectionIndexEntry, deliveredInProjectionSemanticHash, mergeProjectionIndex, projectionIndexManifestKey, DELIVERED_IN_INDEX_DATASET, type DeliveredInProjectionIndex, type DeliveredInProjectionIndexEntry } from "../lib/delivered-in-projection-store";
import type { DeliveredInDayProjection } from "../lib/delivered-in-day-projection";
import { boundedProjectionIndexEntries, DELIVERED_IN_MAX_DAY_PACKAGES, DELIVERED_IN_PROJECTION_HORIZON_DAYS, projectionWindowBounds } from "../lib/server";

test("projection indexes are OPLOC-scoped and contain metadata, not projection bodies", () => {
  const haleon = projectionIndexManifestKey("oploc:haleon");
  const xchange = projectionIndexManifestKey("oploc:xchange");
  assert.notEqual(haleon, xchange);
  assert.match(haleon, /delivered-in\/projection-index\/oploc%3Ahaleon$/);
  const index: DeliveredInProjectionIndex = { oplocId: "oploc:haleon", entries: [{ oplocId: "oploc:haleon", serviceDate: "2026-08-24", projectionVersion: 2, packageVersion: 2, contentHash: "hash", freshness: "current", completeness: "complete", sourceVersion: "menu-day:v2", generatedAt: "2026-08-24T08:00:00Z", state: "available" }] };
  assert.equal(index.entries[0].contentHash, "hash");
  assert.equal("entries" in index.entries[0], false);
  assert.equal(DELIVERED_IN_INDEX_DATASET, "delivered-in/projection-index");
});

test("normal discovery reads the OPLOC index with the shared six-week operational horizon", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.match(server, /readDeliveredInProjectionIndex\(oplocId(?:, requestedWeek)?\)/);
  assert.match(server, /boundedProjectionIndexEntries/);
  assert.equal(DELIVERED_IN_PROJECTION_HORIZON_DAYS, 42);
  assert.deepEqual(projectionWindowBounds("2026-09-01"), { from: "2026-08-31", to: "2026-10-12" });
});

function indexEntry(serviceDate: string, state: "available" | "withdrawn" = "available"): DeliveredInProjectionIndexEntry {
  return { oplocId: "oploc:haleon", serviceDate, projectionVersion: 1, packageVersion: 1, contentHash: serviceDate, freshness: "current", completeness: "complete", sourceVersion: "v1", generatedAt: `${serviceDate}T08:00:00Z`, state };
}

test("historical index growth is date bounded and package fanout has a hard ceiling", () => {
  const entries = Array.from({ length: 200 }, (_, index) => indexEntry(`2026-${String(1 + Math.floor(index / 31)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`));
  const bounded = boundedProjectionIndexEntries([...entries, indexEntry("2026-09-05", "withdrawn")], "2026-09-01");
  assert.ok(bounded.every(entry => entry.serviceDate >= "2026-08-31" && entry.serviceDate <= "2026-10-12"));
  assert.ok(bounded.length <= DELIVERED_IN_MAX_DAY_PACKAGES);
  assert.ok(bounded.some(entry => entry.state === "withdrawn" && entry.serviceDate === "2026-09-05"));
});

test("withdrawn index metadata is excluded from package retrieval", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.match(server, /entry\.state !== "withdrawn"/);
});

test("index merge replaces one day without changing other OPLOC/day metadata", () => {
  const first = { oplocId: "oploc:haleon", serviceDate: "2026-08-24", projectionVersion: 1, packageVersion: 1, contentHash: "a", freshness: "current" as const, completeness: "complete" as const, sourceVersion: "v1", generatedAt: "2026-08-24T08:00:00Z", state: "available" as const };
  const second = { ...first, serviceDate: "2026-08-25", contentHash: "b" };
  const replaced = mergeProjectionIndex({ oplocId: first.oplocId, entries: [first, second] }, { ...first, serviceDate: first.serviceDate, projectionVersion: 2, packageVersion: 2, contentHash: "c" });
  assert.deepEqual(replaced.entries.map(entry => [entry.serviceDate, entry.contentHash]), [["2026-08-24", "c"], ["2026-08-25", "b"]]);
});

test("index lineage compare is idempotent, fail-closed, and withdrawal-safe", () => {
  const current = { ...indexEntry("2026-08-24"), sourceSequence: 8, sourceLineageKey: "publication-day:8|cpu:8" };
  assert.equal(compareDeliveredInProjectionIndexEntry(current, { ...current }).toString(), "idempotent");
  assert.throws(() => compareDeliveredInProjectionIndexEntry(current, { ...current, contentHash: "different" }), /conflicting package content/);
  assert.equal(compareDeliveredInProjectionIndexEntry({ ...current, semanticHash: "semantic-a", contentHash: "old-package" }, { ...current, semanticHash: "semantic-a", contentHash: "new-package" }), "idempotent");
  assert.throws(() => compareDeliveredInProjectionIndexEntry({ ...current, semanticHash: "semantic-a" }, { ...current, semanticHash: "semantic-b" }), /conflicting semantic content/);
  const withdrawn = { ...current, state: "withdrawn" as const, freshness: "current" as const, completeness: "missing" as const };
  assert.equal(compareDeliveredInProjectionIndexEntry(withdrawn, current), "superseded");
  assert.equal(compareDeliveredInProjectionIndexEntry(withdrawn, { ...current, sourceSequence: 9, sourceLineageKey: "publication-day:9|cpu:9" }), "advance");
});

test("semantic projection identity ignores volatile rebuild metadata but detects governed content changes", () => {
  const projection = {
    projectionId: "delivered-in:oploc:haleon:2026-08-24",
    projectionVersion: 1,
    contractVersion: "delivered-in.day.v1",
    oplocId: "oploc:haleon",
    oplocLabel: "Haleon",
    serviceDate: "2026-08-24",
    publicationId: "publication:1",
    publicationDayId: "publication-day:1",
    sourceDayId: "source-day:1",
    date: "2026-08-24",
    dayName: "Monday",
    version: 8,
    contentHash: "menu-hash",
    weekCommencing: "2026-08-24",
    weekEnding: "2026-08-30",
    entries: [{ sourceEntryId: "entry:1", slot: "SALAD 1", dishName: "House salad", quantity: 3, allergens: { milk: "unrecorded" }, allergensVisible: false }],
    allergenSignoff: {},
    siteMenu: { status: "none" },
    sourceLineage: { menu: { publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", version: 8, contentHash: "menu-hash" }, cpu: { orderIds: [], packageVersion: 1, updatedAt: "2026-08-24T08:00:00Z" }, deliveredIn: { generatedAt: "2026-08-24T08:00:00Z" } },
    generatedAt: "2026-08-24T08:00:00Z",
    state: { freshness: "current", completeness: "complete", menu: "present", cpu: "pending", exceptions: [] },
  } as unknown as DeliveredInDayProjection;
  const rebuilt = { ...projection, projectionVersion: 2, generatedAt: "2026-08-24T09:00:00Z", sourceLineage: { ...projection.sourceLineage, cpu: { ...projection.sourceLineage.cpu, packageVersion: 2, updatedAt: "2026-08-24T09:00:00Z" }, deliveredIn: { ...projection.sourceLineage.deliveredIn, generatedAt: "2026-08-24T09:00:00Z" } } };
  assert.equal(deliveredInProjectionSemanticHash(projection), deliveredInProjectionSemanticHash(rebuilt));
  assert.notEqual(deliveredInProjectionSemanticHash(projection), deliveredInProjectionSemanticHash({ ...rebuilt, entries: [{ ...rebuilt.entries[0], quantity: 4 }] }));
});

test("hosted projection promotion is a transaction over the day head and OPLOC index", async () => {
  const store = await readFile(new URL("../lib/delivered-in-projection-store.ts", import.meta.url), "utf8");
  assert.match(store, /writeHostedProjection/);
  assert.match(store, /transaction\.get\(dayRef\)/);
  assert.match(store, /transaction\.get\(indexRef\)/);
  assert.match(store, /persistVerifiedObject/);
  assert.match(store, /projectionHeads\(\)/);
  assert.match(store, /readDeliveredInProjectionForReconciliation/);
  assert.match(store, /semanticHash/);
});

test("hosted index heads are bounded to one OPLOC/week rather than all historical days", async () => {
  const store = await readFile(new URL("../lib/delivered-in-projection-store.ts", import.meta.url), "utf8");
  assert.match(store, /indexHeadRef = \(oplocId: string, weekCommencing: string\)/);
  assert.match(store, /stableDocumentId\(`\$\{oplocId\}:\$\{mondayOf\(weekCommencing\)\}`\)/);
  assert.match(store, /Array\.from\(\{ length: 7 \}/);
  assert.doesNotMatch(store, /projectionIndexHeads\(\)\.doc\(stableDocumentId\(oplocId\)\)/);
});
