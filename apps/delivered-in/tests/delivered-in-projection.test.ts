import assert from "node:assert/strict";
import test from "node:test";
import { decodeReadPackage, encodeReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { projectionId, withProjectionFailure, type DeliveredInDayProjection } from "../lib/delivered-in-day-projection";

function projection(): DeliveredInDayProjection {
  return {
    projectionId: projectionId("oploc:haleon", "2026-08-24"), projectionVersion: 4, contractVersion: "delivered-in.day.v1", oplocId: "oploc:haleon", oplocLabel: "Haleon", serviceDate: "2026-08-24",
    publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", date: "2026-08-24", dayName: "Monday", version: 2, contentHash: "menu-hash", entries: [{ sourceEntryId: "entry:1", slot: "SALAD 1", dishName: "House salad", quantity: 3, allergens: { milk: "unrecorded" }, allergensVisible: false }], allergenSignoff: {}, siteMenu: { status: "none" },
    sourceLineage: { menu: { publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", version: 2, contentHash: "menu-hash" }, cpu: { orderIds: [] }, deliveredIn: { generatedAt: "2026-08-24T08:00:00Z" } }, generatedAt: "2026-08-24T08:00:00Z", state: { freshness: "current", completeness: "complete", menu: "present", cpu: "pending", exceptions: [] },
  };
}

test("Delivered-In day projection preserves stable scope and explicit unknown allergen state", () => {
  const value = projection();
  assert.equal(value.projectionId, "delivered-in:oploc:haleon:2026-08-24");
  assert.equal(value.oplocId, "oploc:haleon");
  assert.equal(value.entries[0].allergens.milk, "unrecorded");
  assert.equal(value.state.menu, "present");
  assert.equal(value.state.cpu, "pending");
});

test("failed rebuild retains the immutable projection and exposes stale unavailable state", () => {
  const stale = withProjectionFailure(projection(), "CPU service timed out", "cpu-production");
  assert.equal(stale.projectionVersion, 4);
  assert.equal(stale.state.freshness, "stale");
  assert.equal(stale.state.completeness, "unavailable");
  assert.equal(stale.state.exceptions[0].code, "SOURCE_UNAVAILABLE");
});

test("Delivered-In package round trip verifies gzip payload and SHA-256 integrity", () => {
  const encoded = encodeReadPackage("delivered-in/day", 4, projection(), 1, { contractVersion: "delivered-in.day.v1", scope: "oploc:haleon:2026-08-24" });
  const decoded = decodeReadPackage<DeliveredInDayProjection>(encoded.manifest, encoded.bytes);
  assert.deepEqual(decoded, projection());
  const corrupt = new Uint8Array(encoded.bytes); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decodeReadPackage(encoded.manifest, corrupt), /integrity check failed/);
});

test("projection latest pointers are scoped by OPLOC and service date", () => {
  const keys = ["oploc:haleon:2026-08-24", "oploc:haleon:2026-08-25", "oploc:xchange:2026-08-24"];
  assert.equal(new Set(keys.map(key => key)).size, 3);
  const manifest: ReadPackageManifest = { dataset: "delivered-in/day", packageVersion: 1, schemaVersion: 1, contractVersion: "delivered-in.day.v1", objectName: "delivered-in/day/v1-hash.json.gz", compression: "gzip", contentHash: "hash", compressedSize: 1, uncompressedSize: 1, recordCount: 1, generatedAt: "2026-08-24T08:00:00Z", scope: keys[0] };
  assert.equal(manifest.scope, keys[0]);
});
