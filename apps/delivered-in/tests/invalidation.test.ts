import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { invalidateDeliveredInProjection } from "../lib/delivered-in-invalidation";
import { markDeliveredInProjectionStale, readDeliveredInProjection, readDeliveredInProjectionIndex, writeDeliveredInProjection, DELIVERED_IN_PROJECTION_SEMANTICS_VERSION } from "../lib/delivered-in-projection-store";
import type { DeliveredInDayProjection } from "../lib/delivered-in-day-projection";

function projection(oplocId: string, serviceDate: string): DeliveredInDayProjection {
  return {
    projectionId: `delivered-in:${oplocId}:${serviceDate}`, projectionVersion: 0, contractVersion: "delivered-in.day.v1", oplocId, oplocLabel: oplocId, serviceDate,
    publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", date: serviceDate, dayName: "Monday", version: 1, contentHash: "menu-hash", entries: [{ sourceEntryId: "entry:1", slot: "SALAD 1", canonicalDishId: "dish:1", dishName: "Published salad", quantity: 4, allergens: { milk: "unrecorded" }, allergensVisible: false }], allergenSignoff: {}, siteMenu: { status: "none" },
    sourceLineage: { menu: { publicationId: "publication:1", publicationDayId: "publication-day:1", sourceDayId: "source-day:1", version: 1, contentHash: "menu-hash" }, cpu: { orderIds: [] }, deliveredIn: { generatedAt: "2026-08-31T08:00:00Z" } }, generatedAt: "2026-08-31T08:00:00Z", state: { freshness: "current", completeness: "complete", menu: "present", cpu: "pending", exceptions: [] },
  };
}

const request = { headers: new Headers() } as never;

test("CPU enrichment invalidation keeps a published Menu day current and visible", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-delivered-in-cpu-enrichment-"));
  const priorRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await writeDeliveredInProjection(projection("oploc:a", "2026-08-31"));
    assert.equal((await readDeliveredInProjectionIndex("oploc:a"))?.value.entries[0]?.projectionSemanticsVersion, DELIVERED_IN_PROJECTION_SEMANTICS_VERSION);
    let reconciled = false; let context: unknown;
    const result = await invalidateDeliveredInProjection(request, { sourceDomain: "cpu-production", sourceEntityId: "cpu-review:oploc:a:2026-08-31", eventId: "cpu-event:1", eventType: "changed", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "cpu-change-1" }, { reconcile: async (_request, _oplocId, _serviceDate, options) => { reconciled = true; context = options?.reconciliationContext; return { status: "rebuilt" as const, serviceDate: "2026-08-31", oplocId: "oploc:a" }; } });
    assert.equal(result.result, "rebuilt");
    assert.equal(reconciled, true);
    assert.deepEqual(context, { mode: "internal", oplocId: "oploc:a", serviceDate: "2026-08-31" });
    const current = await readDeliveredInProjection("oploc:a", "2026-08-31");
    assert.equal(current?.value.state.freshness, "current");
    assert.equal(current?.value.state.completeness, "complete");
    assert.equal(current?.value.state.menu, "present");
    assert.equal(current?.value.entries[0].quantity, 4);
    assert.equal(current?.value.entries[0].allergens.milk, "unrecorded");
    assert.equal(current?.value.entries[0].allergensVisible, false);
  } finally {
    if (priorRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = priorRoot;
    await rm(root, { recursive: true, force: true });
  }
});

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

test("late stale amendment cannot invalidate a newer menu package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-delivered-in-amendment-order-"));
  const prior = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await writeDeliveredInProjection(projection("oploc:a", "2026-08-31"));
    assert.equal(await markDeliveredInProjectionStale({ sourceDomain: "menu-planning", sourceEntityId: "source-day:1", eventId: "event:old-amendment", eventType: "amended", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "source-day:v0" }), "older");
    assert.ok((await readDeliveredInProjection("oploc:a", "2026-08-31"))?.value.state.completeness === "complete");
  } finally {
    if (prior === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test("a withdrawal blocks an out-of-order amendment while retaining audit bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-delivered-in-withdrawal-order-"));
  const prior = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await writeDeliveredInProjection(projection("oploc:a", "2026-08-31"));
    assert.equal(await markDeliveredInProjectionStale({ sourceDomain: "menu-planning", sourceEntityId: "source-day:1", eventId: "event:withdraw-v2", eventType: "withdrawn", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "source-day:v2" }), "withdrawn");
    assert.equal(await markDeliveredInProjectionStale({ sourceDomain: "menu-planning", sourceEntityId: "source-day:1", eventId: "event:amend-v1", eventType: "amended", serviceDate: "2026-08-31", oplocId: "oploc:a", sourceVersion: "source-day:v1" }), "older");
    assert.ok(await readDeliveredInProjection("oploc:a", "2026-08-31"));
  } finally {
    if (prior === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
});
