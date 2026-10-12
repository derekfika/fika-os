import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";
import { cpuProjectionPackageIsCurrent, publishCpuProjectionPackage, getCpuProjectionPackage, publishMonotonicCpuPackage } from "../lib/cpu-read-package";
import { downloadCpuPackageBytes } from "../lib/cpu-package-store";
import { cpuProjectionCacheEntryMatches } from "../app/lib/cpu-indexeddb";
import { buildCpuDayProjection, recoverMissingCpuDayProjection, initialiseEmptyCpuWeekProjection, type CpuDayProjection, type CpuWeekProjection, type EmptyWeekInitialisationDependencies } from "../lib/cpu-projection";
import { europeLondonDate } from "../lib/operational-date";

const day = (date: string): CpuDayProjection => ({ serviceDate: date, revision: 4, lastChangeSequence: 12, orders: [], summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 }, rebuiltAt: "2026-08-31T10:00:00.000Z" });
const week = (): CpuWeekProjection => ({ ...day("all"), serviceDate: "2026-08-31", weekCommencing: "2026-08-31" } as CpuWeekProjection);

test("a historical missing daily package recovers canonical quantities without inventing work", async () => {
  const serviceDate = "2026-08-24";
  const order = { canonicalId: "historic:hospitality:1", serviceDate, requiredBy: `${serviceDate}T12:00`, serviceWindow: { startTime: "12:00" }, sourceBookingId: "historic:booking:1", status: "draft", priority: "normal", origin: "hospitality_booking", version: 1, exceptions: [], lines: [{ canonicalId: "historic:line:1", sourceBookingLineId: "historic:booking:1:line:1", itemName: "Sandwich Lunch", customerQuantity: 12, customerUnit: "person", productionQuantity: 36, productionUnit: "piece", workstream: "sandwiches", dietaries: {} }] } as never;
  const recovered = await recoverMissingCpuDayProjection(undefined as never, serviceDate, async (_, requestedDate) => {
    assert.equal(requestedDate, serviceDate);
    const projection = buildCpuDayProjection(requestedDate, [order], [], 7);
    const encoded = encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection }, projection.orders.length);
    return { projection: decodeReadPackage<{ projection: CpuDayProjection }>(encoded.manifest, encoded.bytes).projection, manifest: encoded.manifest };
  });
  assert.equal(recovered.projection.orders.length, 1);
  assert.equal(recovered.projection.orders[0].quantities[0].productionQuantity, 36);
  assert.equal(recovered.projection.orders[0].quantities[0].quantity, 12);
  const blank = await recoverMissingCpuDayProjection(undefined as never, "2026-08-25", async (_, date) => {
    const projection = buildCpuDayProjection(date, [order]);
    return { projection, manifest: encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection }, 0).manifest };
  });
  assert.deepEqual(blank.projection.orders, []);
});

test("missing day recovery coalesces concurrent rebuilds and clears failures for a safe retry", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const materialise = async (_: unknown, date: string) => {
    calls += 1;
    await gate;
    const projection = day(date);
    return { projection, manifest: encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection }, 0).manifest };
  };
  const first = recoverMissingCpuDayProjection(undefined as never, "2026-08-26", materialise);
  const second = recoverMissingCpuDayProjection(undefined as never, "2026-08-26", materialise);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  await assert.rejects(recoverMissingCpuDayProjection(undefined as never, "2026-08-27", async () => { throw new Error("Authority unavailable"); }), /Authority unavailable/);
  await recoverMissingCpuDayProjection(undefined as never, "2026-08-27", materialise);
  assert.equal(calls, 2);
  await assert.rejects(recoverMissingCpuDayProjection(undefined as never, "all", materialise), /bounded service date/);
  assert.equal(calls, 2);
});

test("all mutation and handoff day rebuilds use the monotonic package publisher", async () => {
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const helper = route.slice(route.indexOf("async function rebuildCpuProjection"), route.indexOf("async function recordCpuChange"));
  assert.match(helper, /return rebuildCpuDayProjection\(request, serviceDate, lastChangeSequence\)/);
  assert.doesNotMatch(helper, /\.set\(|\bbuildCpuDayProjection\(/);
});

test("CPU operational today uses the Europe/London business date at the UTC boundary", () => {
  assert.equal(europeLondonDate(new Date("2026-08-31T23:30:00.000Z")), "2026-09-01");
  assert.equal(europeLondonDate(new Date("2026-09-01T00:30:00.000Z")), "2026-09-01");
});

test("CPU day package round-trips with gzip/SHA integrity", () => {
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-day", 3, { projection: day("2026-08-31") }, 0, { sourceVersion: "cpu-change-12" });
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), { projection: day("2026-08-31") });
  assert.match(encoded.manifest.objectName, /v3-[a-f0-9]{64}\.json\.gz$/);
});

test("hosted CPU package reads preserve compressed bytes for SHA verification", async () => {
  let options: { decompress?: boolean } | undefined;
  const stored = Buffer.from([31, 139, 8, 0]);
  const bytes = await downloadCpuPackageBytes({ download: async (next) => { options = next; return [stored]; } });
  assert.deepEqual(bytes, stored);
  assert.deepEqual(options, { decompress: false });
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

test("normal CPU package miss and corruption do not write or reconstruct", async () => {
  let writes = 0;
  const missingStore = { async getManifest() { return undefined; }, async get() { return undefined; }, async has() { return false; }, async putImmutable() { writes += 1; }, async putManifest() { writes += 1; } };
  assert.equal(await getCpuProjectionPackage("2026-08-31", undefined, missingStore), undefined);
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection: day("2026-08-31") }, 0);
  const corruptStore = { async getManifest() { return encoded.manifest; }, async get() { return new Uint8Array([1, 2, 3]); }, async has() { return true; }, async putImmutable() { writes += 1; }, async putManifest() { writes += 1; } };
  await assert.rejects(() => getCpuProjectionPackage("2026-08-31", undefined, corruptStore), /integrity check failed/);
  assert.equal(writes, 0);
});

test("CPU package publication reuses the manifest when projection contents and sequence are unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-cpu-package-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const first = await publishCpuProjectionPackage(day("2026-08-31"));
    const second = await publishCpuProjectionPackage(day("2026-08-31"));
    assert.equal(first.packageVersion, 1);
    assert.equal(second.packageVersion, 1);
    const retrieved = await getCpuProjectionPackage("2026-08-31");
    assert.deepEqual(retrieved?.value.projection, day("2026-08-31"));
    assert.equal(retrieved?.manifest.packageVersion, 1);
    const manifest = JSON.parse(await readFile(path.join(root, "manifests", "cpu-production_projection_day_2026-08-31.json"), "utf8"));
    assert.equal(manifest.contentHash, second.contentHash);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale local package materialiser cannot replace a newer source sequence", async () => {
  const manifests = new Map<string, ReturnType<typeof encodeReadPackage>["manifest"]>();
  const objects = new Map<string, Uint8Array>();
  const store = {
    async putImmutable(name: string, bytes: Uint8Array) { objects.set(name, bytes); },
    async get(name: string) { return objects.get(name); },
    async has(name: string) { return objects.has(name); },
    async getManifest(key: string) { return manifests.get(key); },
    async putManifest(key: string, manifest: ReturnType<typeof encodeReadPackage>["manifest"]) { manifests.set(key, manifest); },
  };
  const old = encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection: { ...day("2026-08-31"), lastChangeSequence: 7 } }, 0, { sourceVersion: "cpu-change-7", sourceHash: "old" });
  const newer = encodeReadPackage("snapshots/cpu-production/projection-day", 2, { projection: { ...day("2026-08-31"), lastChangeSequence: 8 } }, 0, { sourceVersion: "cpu-change-8", sourceHash: "new" });
  await publishMonotonicCpuPackage(store, "cpu-production/projection/day/2026-08-31", newer, "new");
  await publishMonotonicCpuPackage(store, "cpu-production/projection/day/2026-08-31", old, "old");
  assert.equal(manifests.get("cpu-production/projection/day/2026-08-31")?.sourceVersion, "cpu-change-8");
});

test("same CPU package sequence with different content fails closed", async () => {
  const manifests = new Map<string, ReturnType<typeof encodeReadPackage>["manifest"]>();
  const objects = new Map<string, Uint8Array>();
  const store = {
    async putImmutable(name: string, bytes: Uint8Array) { objects.set(name, bytes); },
    async get(name: string) { return objects.get(name); },
    async has(name: string) { return objects.has(name); },
    async getManifest(key: string) { return manifests.get(key); },
    async putManifest(key: string, manifest: ReturnType<typeof encodeReadPackage>["manifest"]) { manifests.set(key, manifest); },
  };
  const first = encodeReadPackage("snapshots/cpu-production/projection-day", 1, { projection: day("2026-08-31") }, 0, { sourceVersion: "cpu-change-12", sourceHash: "first" });
  const conflict = encodeReadPackage("snapshots/cpu-production/projection-day", 2, { projection: { ...day("2026-08-31"), rebuiltAt: "different" } }, 0, { sourceVersion: "cpu-change-12", sourceHash: "second" });
  await publishMonotonicCpuPackage(store, "cpu-production/projection/day/2026-08-31", first, "first");
  await assert.rejects(() => publishMonotonicCpuPackage(store, "cpu-production/projection/day/2026-08-31", conflict, "second"), /conflicting content/);
});

test("current stored projection with a missing manifest is republished during reconciliation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-cpu-reconcile-package-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const current = week();
    assert.equal(await cpuProjectionPackageIsCurrent(current), false);
    const published = await publishCpuProjectionPackage(current);
    assert.equal(published.packageVersion, 1);
    assert.equal(await cpuProjectionPackageIsCurrent(current), true);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("unseen empty week normal-read initialisation publishes one valid zero-order package", async () => {
  const weekCommencing = "2030-01-07";
  let stored: CpuWeekProjection | undefined;
  let writes = 0;
  let publications = 0;
  const dependencies: EmptyWeekInitialisationDependencies = {
    loadOrders: async () => [],
    readProjection: async () => ({ exists: Boolean(stored), data: () => stored }),
    writeProjection: async (_week, projection) => { writes += 1; stored = projection; },
    publishPackage: async (projection) => { publications += 1; return encodeReadPackage("snapshots/cpu-production/projection-week", 1, { projection }, 0).manifest; },
  };
  const result = await initialiseEmptyCpuWeekProjection(undefined as never, weekCommencing, dependencies);
  assert.equal(result?.projection.weekCommencing, weekCommencing);
  assert.deepEqual(result?.projection.orders, []);
  assert.deepEqual(result?.projection.summary, { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 });
  assert.equal(writes, 1);
  assert.equal(publications, 1);
  const second = await initialiseEmptyCpuWeekProjection(undefined as never, weekCommencing, dependencies);
  assert.deepEqual(second?.projection, result?.projection);
  assert.equal(writes, 1);
  assert.equal(publications, 2);
});

test("non-empty missing week package refuses empty-week masquerading", async () => {
  const weekCommencing = "2030-01-07";
  let writes = 0;
  let publications = 0;
  const dependencies: EmptyWeekInitialisationDependencies = {
    loadOrders: async () => [{ requiredBy: `${weekCommencing}T12:00:00` } as never],
    readProjection: async () => ({ exists: false, data: () => undefined }),
    writeProjection: async () => { writes += 1; },
    publishPackage: async () => { publications += 1; return encodeReadPackage("snapshots/cpu-production/projection-week", 1, { projection: week() }, 0).manifest; },
  };
  assert.equal(await initialiseEmptyCpuWeekProjection(undefined as never, weekCommencing, dependencies), undefined);
  assert.equal(writes, 0);
  assert.equal(publications, 0);
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

test("normal CPU projection GET recovers missing day/week data but fails closed on integrity errors", async () => {
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const branch = route.slice(route.indexOf('if (request.nextUrl.searchParams.get("projection") === "1")'));
  const normalBranch = branch.slice(0, branch.indexOf('} else recordCpuPackageFallback("explicit-reconciliation")'));
  assert.match(normalBranch, /recoverMissingCpuWeekProjection/);
  assert.match(normalBranch, /recoverMissingCpuDayProjection/);
  assert.match(normalBranch, /CPU_PROJECTION_PACKAGE_INTEGRITY_FAILURE/);
  const integrityBranch = normalBranch.slice(normalBranch.indexOf("} catch {"), normalBranch.indexOf('recordCpuPackageFallback("missing")'));
  assert.doesNotMatch(integrityBranch, /recoverMissingCpu/);
  const initializer = await readFile(new URL("../lib/cpu-projection.ts", import.meta.url), "utf8");
  assert.match(initializer, /sourceOrders\.length > 0\) return undefined/);
  assert.match(initializer, /dependencies\.publishPackage\(week\)/);
  assert.match(initializer, /dependencies\.loadOrders\(request, weekCommencing\)/);
});

test("explicit CPU reconciliation treats package absence as a refresh reason", async () => {
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const reconciliation = route.slice(route.indexOf("const storedStartedAt"));
  assert.match(reconciliation, /cpuProjectionPackageIsCurrent/);
  assert.match(reconciliation, /!packageCurrent/);
  assert.match(reconciliation, /rebuildCpuDayProjection\(request, projectionDate\)/);
});
