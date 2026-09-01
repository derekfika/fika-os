import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeProjectionIndex, projectionIndexManifestKey, DELIVERED_IN_INDEX_DATASET, type DeliveredInProjectionIndex, type DeliveredInProjectionIndexEntry } from "../lib/delivered-in-projection-store";
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
  assert.match(server, /readDeliveredInProjectionIndex\(oplocId\)/);
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
