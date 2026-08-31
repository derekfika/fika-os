import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";
import { publishCpuProjectionPackage, getCpuProjectionPackage } from "../lib/cpu-read-package";
import { cpuProjectionCacheEntryMatches } from "../app/lib/cpu-indexeddb";
import type { CpuDayProjection, CpuWeekProjection } from "../lib/cpu-projection";

const day = (date: string): CpuDayProjection => ({ serviceDate: date, revision: 4, lastChangeSequence: 12, orders: [], summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 }, rebuiltAt: "2026-08-31T10:00:00.000Z" });
const week = (): CpuWeekProjection => ({ ...day("all"), serviceDate: "2026-08-31", weekCommencing: "2026-08-31" });

test("CPU day package round-trips with gzip/SHA integrity", () => {
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-day", 3, { projection: day("2026-08-31") }, 0, { sourceVersion: "cpu-change-12" });
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), { projection: day("2026-08-31") });
  assert.match(encoded.manifest.objectName, /v3-[a-f0-9]{64}\.json\.gz$/);
});

test("CPU week package round-trips and immutable object names change by version", () => {
  const first = encodeReadPackage("snapshots/cpu-production/projection-week", 1, { projection: week() }, 0);
  const second = encodeReadPackage("snapshots/cpu-production/projection-week", 2, { projection: week() }, 0);
  assert.deepEqual(decodeReadPackage(second.manifest, second.bytes), { projection: week() });
  assert.notEqual(first.manifest.objectName, second.manifest.objectName);
});

test("CPU package retrieval rejects tampered bytes through shared SHA validation", () => {
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection: day("2026-08-31") }, 0);
  assert.throws(() => decodeReadPackage(encoded.manifest, new Uint8Array([1, 2, 3])), /integrity check failed/);
});

test("CPU package publication advances the manifest without changing projection contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-cpu-package-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const first = await publishCpuProjectionPackage(day("2026-08-31"));
    const second = await publishCpuProjectionPackage(day("2026-08-31"));
    assert.equal(first.packageVersion, 1);
    assert.equal(second.packageVersion, 2);
    const retrieved = await getCpuProjectionPackage("2026-08-31");
    assert.deepEqual(retrieved?.value.projection, day("2026-08-31"));
    assert.equal(retrieved?.manifest.packageVersion, 2);
    const manifest = JSON.parse(await readFile(path.join(root, "manifests", "cpu-production_projection_day_2026-08-31.json"), "utf8"));
    assert.equal(manifest.contentHash, second.contentHash);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("CPU dashboard stores package metadata and package delivery precedes source reconciliation", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const indexedDb = await readFile(new URL("../app/lib/cpu-indexeddb.ts", import.meta.url), "utf8");
  assert.match(page, /packageVersion/);
  assert.match(page, /contentHash/);
  assert.match(page, /sourceVersion/);
  const projectionBranch = route.slice(route.indexOf('if (request.nextUrl.searchParams.get("projection") === "1")'));
  assert.ok(projectionBranch.indexOf("getCpuProjectionPackage") < projectionBranch.indexOf("productionQueueForWeek"));
  assert.match(indexedDb, /entry\.cacheScope === cacheScope/);
  assert.match(indexedDb, /schemaVersion === CPU_CACHE_SCHEMA_VERSION/);
  const entry = { key: "day:2026-08-31", schemaVersion: 1, cacheScope: "local:project:actor", fetchedAt: "now", lastChangeSequence: 12, revision: 1, packageVersion: 2, contentHash: "hash", sourceVersion: "cpu-change-12", value: {} };
  assert.equal(cpuProjectionCacheEntryMatches(entry, entry.cacheScope, { schemaVersion: 1, packageVersion: 2, contentHash: "wrong", sourceVersion: "cpu-change-12" }), false);
});
