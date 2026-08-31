import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { markDeliveredInProjectionStale, readDeliveredInProjection, writeDeliveredInProjection } from "../lib/delivered-in-projection-store";
import type { DeliveredInDayProjection } from "../lib/delivered-in-day-projection";

function projection(oplocId: string, serviceDate: string): DeliveredInDayProjection {
  return {
    projectionId: `delivered-in:${oplocId}:${serviceDate}`, projectionVersion: 0, contractVersion: "delivered-in.day.v1", oplocId, oplocLabel: oplocId, serviceDate,
    publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", date: serviceDate, dayName: "Monday", version: 1, contentHash: "menu-hash", entries: [], allergenSignoff: {}, siteMenu: { status: "none" },
    sourceLineage: { menu: { publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", version: 1, contentHash: "menu-hash" }, cpu: { orderIds: [] }, deliveredIn: { generatedAt: "2026-08-31T08:00:00Z" } }, generatedAt: "2026-08-31T08:00:00Z", state: { freshness: "current", completeness: "complete", menu: "empty", cpu: "pending", exceptions: [] },
  };
}

test("bounded invalidation preserves the package, isolates OPLOC/day, and rejects duplicate or older signals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-delivered-in-invalidation-"));
  const prior = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await writeDeliveredInProjection(projection("oploc:a", "2026-08-31"));
    await writeDeliveredInProjection(projection("oploc:b", "2026-08-31"));
    const change = { sourceDomain: "cpu-production" as const, sourceEntityId: "order:a", eventId: "event:1", eventType: "changed" as const, serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "cpu-change-12" };
    assert.equal(await markDeliveredInProjectionStale(change), "stale");
    assert.equal(await markDeliveredInProjectionStale(change), "duplicate");
    assert.equal(await markDeliveredInProjectionStale({ ...change, eventId: "event:0", sourceVersion: "cpu-change-11" }), "older");
    assert.equal(await markDeliveredInProjectionStale({ ...change, eventId: "event:b", oplocId: "oploc:b", sourceVersion: "cpu-change-12" }), "stale");
  } finally {
    if (prior === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test("withdrawal tombstones one scope without deleting its last-known-good package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-delivered-in-withdrawal-"));
  const prior = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await writeDeliveredInProjection(projection("oploc:a", "2026-08-31"));
    assert.equal(await markDeliveredInProjectionStale({ sourceDomain: "menu-planning", sourceEntityId: "publication-day:1", eventId: "event:withdraw", eventType: "withdrawn", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "publication-day:2" }), "withdrawn");
    assert.equal(await markDeliveredInProjectionStale({ sourceDomain: "menu-planning", sourceEntityId: "publication-day:1", eventId: "event:withdraw", eventType: "withdrawn", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "publication-day:2" }), "withdrawn");
    assert.ok(await readDeliveredInProjection("oploc:a", "2026-08-31"));
  } finally {
    if (prior === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
});
