import assert from "node:assert/strict";
import test from "node:test";

/**
 * Hosted-mode divergence recovery. Runs against the real Firestore emulator (package heads + authoritative projection documents) and a
 * real in-memory immutable object store through the hosted publisher path. The publisher's ordinary rule (same sequence + different
 * content is a conflict) is unchanged; recovery is explicit, narrowly preconditioned and compare-and-set.
 *
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/cpu-production && npx tsx --test tests/cpu-hosted-package-recovery.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
process.env.FIKA_CPU_PLAN_STORE = "memory";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { buildCpuDayProjection } = await import("../lib/cpu-projection");
const { publishCpuProjectionPackage, publishMonotonicCpuPackage, getCpuProjectionPackage, getCpuProjectionManifest, setCpuHostedPackageRuntimeForTests } = await import("../lib/cpu-read-package");
const { setCpuPackageStoreForTests } = await import("../lib/cpu-package-store");
const { cpuProjectionContentHash, cpuProjectionPackageHeads, cpuProjections } = await import("../lib/cpu-projection-repository");
const { encodeReadPackage } = await import("@fika/server-shared/read-package");
const { loadCpuDashboardProjection } = await import("../app/lib/cpu-dashboard-projection-loader");
const { loadCpuAllergenProjection } = await import("../app/lib/cpu-allergen-projection-loader");
type Store = import("@fika/server-shared/read-package").ReadPackageStore;

class MemoryStore implements Store {
  objects = new Map<string, Buffer>();
  puts: string[] = [];
  onPut?: (name: string) => Promise<void>;
  async putImmutable(name: string, bytes: Uint8Array) { this.puts.push(name); if (this.onPut) await this.onPut(name); if (!this.objects.has(name)) this.objects.set(name, Buffer.from(bytes)); }
  async get(name: string) { const found = this.objects.get(name); return found ? Buffer.from(found) : undefined; }
  async has(name: string) { return this.objects.has(name); }
  async getManifest() { return undefined; }
  async putManifest() { return undefined; }
}
const store = new MemoryStore();
setCpuPackageStoreForTests(store);
setCpuHostedPackageRuntimeForTests(true); // the real HOSTED publisher / reader path (heads in Firestore, immutable objects in the store)

const run = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const nextWeek = () => new Date(Date.UTC(2031, 0, 6 + 7 * (++counter))).toISOString().slice(0, 10);
const SEQ = 684;
const order = (id: string, date: string, status = "accepted") => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "1", version: 2, currentRevision: 1, requirementIds: [], sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`,
  origin: "menu_planning", requiresDelivery: true, destinationOplocId: "oploc:test", destinationLabel: "Test site", serviceType: "lunch", serviceDate: date, requiredBy: `${date}T11:00:00.000Z`,
  serviceWindow: { startTime: "11:00", endTime: "12:00" }, status, priority: "normal", lines: [], exceptions: [], createdAt: "2026-10-08T03:20:03.396Z", createdBy: "test", audit: [],
});
/** A week projection at sequence SEQ with the given orders; `marked` stamps the authority-binding marker like the current builder. */
const weekProjection = (week: string, orders: Array<ReturnType<typeof order>>, marked = true) => {
  const built = buildCpuDayProjection("all", orders as never, [], SEQ, 1) as unknown as Record<string, unknown>;
  if (!marked) delete built.authorityBindingVersion;
  return { ...built, serviceDate: week, weekCommencing: week } as never;
};
const dayProjection = (date: string, orders: Array<ReturnType<typeof order>>) => buildCpuDayProjection(date, orders as never, [], SEQ, 1) as never;
const headRef = (key: string) => cpuProjectionPackageHeads().doc(key.replace(/[^A-Za-z0-9:_-]+/g, "_"));
const weekKey = (week: string) => `cpu-production/projection/week:${week}`;
const dayKey = (date: string) => `cpu-production/projection/day/${date}`;
const readHead = async (key: string) => (await headRef(key).get()).data() as Record<string, any> | undefined;
const setDocument = async (id: string, projection: Record<string, unknown>) => cpuProjections().doc(id).set({ ...projection, projectionContentHash: cpuProjectionContentHash(projection as never), revision: 1 });

/** The observed staging shape: package head CURRENT at sequence N for content A; the authoritative document at the SAME sequence N holds content B. */
async function seedDivergence(kind: "week" | "day", date: string) {
  const oldContent = [order(`production-order:v1:menu-planning:${run}:A-${date}`, date)];
  const newContent = [order(`production-order:v1:menu-planning:${run}:A-${date}`, date), order(`production-order:v1:menu-planning:${run}:B-${date}`, date)];
  const oldProjection = kind === "week" ? weekProjection(date, oldContent) : dayProjection(date, oldContent);
  const newProjection = kind === "week" ? weekProjection(date, newContent) : dayProjection(date, newContent);
  const oldManifest = await publishCpuProjectionPackage(oldProjection);
  const id = kind === "week" ? `week:${date}` : date;
  await setDocument(id, newProjection as never);
  return { oldProjection, newProjection, oldManifest, id, key: kind === "week" ? weekKey(date) : dayKey(date), weekCommencing: kind === "week" ? date : undefined };
}
const lookup = (seed: Awaited<ReturnType<typeof seedDivergence>>, date: string) => getCpuProjectionPackage(date, seed.weekCommencing);

test("matching document and package at sequence N: no recovery, no new package, no head movement", opts, async () => {
  const date = nextWeek();
  const projection = weekProjection(date, [order(`production-order:v1:menu-planning:${run}:same`, date)]);
  const manifest = await publishCpuProjectionPackage(projection);
  await setDocument(`week:${date}`, projection as never);
  const headBefore = await readHead(weekKey(date));
  const putsBefore = store.puts.length;
  const again = await publishCpuProjectionPackage(projection, { authoritativeDivergenceRecovery: true });
  assert.equal(again.packageVersion, manifest.packageVersion);
  assert.equal(again.objectName, manifest.objectName);
  assert.equal(store.puts.length, putsBefore, "no new object");
  assert.deepEqual(await readHead(weekKey(date)), headBefore, "head did not move");
  assert.ok(await getCpuProjectionPackage(date, date), "the matching package is served");
});

test("divergent document and package at the same sequence: explicit recovery publishes a NEW immutable generation and atomically promotes the head", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  assert.equal(await lookup(seed, date), undefined, "diverged: the hosted reader treats the package as stale (the observed staging state)");
  assert.equal(await getCpuProjectionManifest(date, date), undefined);
  const oldBytes = await store.get(seed.oldManifest.objectName);
  const recovered = await publishCpuProjectionPackage(seed.newProjection, { authoritativeDivergenceRecovery: true });
  assert.ok(recovered.packageVersion > seed.oldManifest.packageVersion, "a higher package generation");
  assert.notEqual(recovered.objectName, seed.oldManifest.objectName, "a new immutable object");
  assert.deepEqual(await store.get(seed.oldManifest.objectName), oldBytes, "the old package object is untouched");
  const head = (await readHead(seed.key))!;
  assert.equal(head.state, "current");
  assert.equal(head.sourceSequence, SEQ, "the projection sequence is unchanged");
  assert.equal(head.sourceHash, cpuProjectionContentHash(seed.newProjection));
  assert.equal(head.manifest.packageVersion, recovered.packageVersion);
  assert.equal(head.recovery.reason, "authoritative_divergence");
  assert.equal(head.recovery.replaced.contentHash, seed.oldManifest.contentHash);
  const served = await lookup(seed, date);
  assert.ok(served, "the repaired package is served");
  assert.equal((served!.value.projection as { authorityBindingVersion?: number }).authorityBindingVersion, 1, "the repaired package carries the marker");
  assert.equal(served!.value.projection.orders.length, 2);
  const identity = (await getCpuProjectionManifest(date, date))!;
  assert.equal(identity.packageVersion, recovered.packageVersion);
  assert.equal(identity.sourceVersion, `cpu-change-${SEQ}`, "same projection sequence");
  assert.notEqual(identity.contentHash, seed.oldManifest.contentHash);
});

test("the ordinary publisher rule is unchanged: same sequence + different content without recovery, or with unmet preconditions, is still a conflict", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const headBefore = await readHead(seed.key);
  await assert.rejects(() => publishCpuProjectionPackage(seed.newProjection), /conflicting content/);
  // explicit recovery, but the authoritative document does NOT hold the incoming content: precondition unmet
  const stranger = weekProjection(date, [order(`production-order:v1:menu-planning:${run}:C-${date}`, date)]);
  await assert.rejects(() => publishCpuProjectionPackage(stranger, { authoritativeDivergenceRecovery: true }), /conflicting content/);
  assert.deepEqual(await readHead(seed.key), headBefore, "the head never moved");
});

test("a lower sequence is still refused, with or without the recovery flag", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const lower = { ...(seed.newProjection as Record<string, unknown>), lastChangeSequence: SEQ - 1 } as never;
  const headBefore = await readHead(seed.key);
  const plain = await publishCpuProjectionPackage(lower);
  const flagged = await publishCpuProjectionPackage(lower, { authoritativeDivergenceRecovery: true });
  assert.equal(plain.packageVersion, seed.oldManifest.packageVersion, "superseded: the current package is returned, nothing is overwritten");
  assert.equal(flagged.packageVersion, seed.oldManifest.packageVersion);
  assert.deepEqual(await readHead(seed.key), headBefore);
});

test("concurrent recoverers settle on ONE promotion: no split-brain head", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const hash = cpuProjectionContentHash(seed.newProjection);
  const version = seed.oldManifest.packageVersion + 1;
  const encode = () => encodeReadPackage("snapshots/cpu-production/projection-week", version, { projection: seed.newProjection }, (seed.newProjection as { orders: unknown[] }).orders.length, {
    contractVersion: "cpu-production.projection.v1", sourceVersion: `cpu-change-${SEQ}`, sourceHash: hash, scope: `week:${date}`,
  });
  // two independent recoverers (bypassing in-process coalescing) race for the same authoritative content
  const results = await Promise.allSettled([1, 2, 3].map(() => publishMonotonicCpuPackage(store, seed.key, encode(), hash, { divergenceRecovery: { authoritativeDocumentId: seed.id } })));
  const fulfilled = results.filter(result => result.status === "fulfilled") as Array<PromiseFulfilledResult<{ packageVersion: number; objectName: string }>>;
  assert.ok(fulfilled.length >= 1, "at least one promotion succeeded");
  const head = (await readHead(seed.key))!;
  assert.equal(head.manifest.packageVersion, version, "exactly one new generation");
  for (const result of fulfilled) assert.equal(result.value.objectName, head.manifest.objectName, "every winner reports the single promoted package");
  for (const result of results) if (result.status === "rejected") assert.equal((result.reason as { code?: string }).code, "CPU_PACKAGE_RECOVERY_STALE", "a loser fails safely and reloads");
});

test("stale recovery: if the head changes before the repair commits, it fails and never overwrites", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const hash = cpuProjectionContentHash(seed.newProjection);
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-week", seed.oldManifest.packageVersion + 1, { projection: seed.newProjection }, 2, {
    contractVersion: "cpu-production.projection.v1", sourceVersion: `cpu-change-${SEQ}`, sourceHash: hash, scope: `week:${date}`,
  });
  // another writer promotes a different head while this recoverer uploads its object
  let rival: unknown;
  store.onPut = async () => {
    store.onPut = undefined;
    rival = { state: "current", sourceSequence: SEQ, sourceHash: "rival-hash", manifest: { ...seed.oldManifest, packageVersion: seed.oldManifest.packageVersion + 5, contentHash: "f".repeat(64), sourceHash: "rival-hash" }, updatedAt: new Date().toISOString() };
    await headRef(seed.key).set(rival as never);
  };
  await assert.rejects(() => publishMonotonicCpuPackage(store, seed.key, encoded, hash, { divergenceRecovery: { authoritativeDocumentId: seed.id } }), (error: { code?: string }) => error.code === "CPU_PACKAGE_RECOVERY_STALE");
  assert.deepEqual(await readHead(seed.key), rival, "the rival head was not overwritten");
});

test("a corrupt package is never silently repaired: the integrity failure stands and no new package is written", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  store.objects.set(seed.oldManifest.objectName, Buffer.from("corrupted package bytes"));
  const headBefore = await readHead(seed.key);
  const putsBefore = store.puts.length;
  await assert.rejects(() => publishCpuProjectionPackage(seed.newProjection, { authoritativeDivergenceRecovery: true }));
  assert.deepEqual(await readHead(seed.key), headBefore, "head unchanged");
  assert.equal(store.puts.length, putsBefore, "nothing was written");
  // and a reader of the (still current, matching) corrupt package would see the integrity failure rather than a rebuild
  await setDocument(`week:${date}`, seed.oldProjection as never);
  await assert.rejects(() => getCpuProjectionPackage(date, date));
});

// ---- the warm-client cache must see the promotion even though the projection SEQUENCE did not change ---------------------------------
const identityFetch = (kind: "week" | "day", date: string, state: { served: number }) => (async (input: RequestInfo | URL) => {
  const url = String(input);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.includes("cacheScope")) return json({ cacheScope: "staging:fika-os-dev:actor-1" });
  const manifest = await getCpuProjectionManifest(date, kind === "week" ? date : undefined);
  if (url.includes("projectionHead")) return json(manifest ? { lastChangeSequence: Number(manifest.sourceVersion!.replace("cpu-change-", "")), packageVersion: manifest.packageVersion, contentHash: manifest.contentHash, sourceVersion: manifest.sourceVersion } : { lastChangeSequence: 0, packageVersion: 0, revision: 0 });
  state.served += 1;
  const served = await getCpuProjectionPackage(date, kind === "week" ? date : undefined);
  if (!served) return json({ error: { code: "CPU_PROJECTION_PACKAGE_UNAVAILABLE", message: "unavailable" } }, 503);
  return json({ projection: served.value.projection, package: { packageVersion: served.manifest.packageVersion, contentHash: served.manifest.contentHash, sourceVersion: served.manifest.sourceVersion } });
}) as typeof fetch;

for (const kind of ["week", "day"] as const) {
  test(`warm client (${kind}): an old cached body cannot survive the head promotion; the package identity (not only the sequence) changes`, opts, async () => {
    const date = nextWeek();
    const seed = await seedDivergence(kind, date);
    // 1. the client caches the OLD package (sequence N) as a trusted, authority-bound entry
    const oldCached = { key: kind === "week" ? `week:${date}:all` : `day:${date}`, schemaVersion: 1, cacheScope: "staging:fika-os-dev:actor-1", fetchedAt: "2026-10-08T00:00:00.000Z", lastChangeSequence: SEQ, revision: 1,
      packageVersion: seed.oldManifest.packageVersion, contentHash: seed.oldManifest.contentHash, sourceVersion: seed.oldManifest.sourceVersion, authorityBindingVersion: 1, value: seed.oldProjection };
    // 2. the authoritative document diverged at N (seeded); 3. hosted recovery publishes a new generation at N and promotes the head
    const recovered = await publishCpuProjectionPackage(seed.newProjection, { authoritativeDivergenceRecovery: true });
    assert.equal(recovered.sourceVersion, oldCached.sourceVersion, "the SEQUENCE identity is identical before and after recovery");
    assert.notEqual(recovered.packageVersion, oldCached.packageVersion);
    assert.notEqual(recovered.contentHash, oldCached.contentHash);
    // 4. + 5. the head identity the client compares changed, so it refetches and never serves the old body
    const state = { served: 0 };
    const writes: Array<{ packageVersion?: number; contentHash?: string }> = [];
    const deps = { fetch: identityFetch(kind, date, state), read: async () => oldCached as never, write: async (entry: { packageVersion?: number; contentHash?: string }) => { writes.push(entry); } };
    const result = kind === "week"
      ? await loadCpuDashboardProjection({ view: "week", date, scope: "all" }, undefined, deps as never)
      : await loadCpuAllergenProjection(date, "all" as never, deps as never);
    assert.equal(state.served, 1, "the body was refetched");
    assert.notEqual((result as { cacheHit?: boolean }).cacheHit, true);
    assert.equal((result.projection as { orders: unknown[] }).orders.length, 2, "the NEW body is served, not the old cached one (1 order)");
    assert.equal(writes[0].packageVersion, recovered.packageVersion, "the cache now holds the recovered package identity");
  });
}

// ---- the REAL missing-package recovery path (what a page load runs) repairs the diverged week -------------------------------------------
test("recoverMissingCpuWeekProjection (the real load-time recovery) repairs the staging shape without any manual edit, and a second read is a plain hit", opts, async () => {
  const { NextRequest } = await import("next/server");
  const { recoverMissingCpuWeekProjection } = await import("../lib/cpu-projection");
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const canonical = [order(`production-order:v1:menu-planning:${run}:A-${date}`, date), order(`production-order:v1:menu-planning:${run}:B-${date}`, date)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url || String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/production") return json({ orders: canonical });
    return json({ oplocs: [] });
  }) as typeof fetch;
  try {
    assert.equal(await getCpuProjectionPackage(date, date), undefined, "before: the package is treated as missing (stale vs the authoritative document)");
    const recovered = await recoverMissingCpuWeekProjection(new NextRequest("http://localhost:3400/api/production?projection=1"), date);
    assert.ok(recovered.manifest.packageVersion > seed.oldManifest.packageVersion);
    const head = (await readHead(seed.key))!;
    const stored = (await cpuProjections().doc(seed.id).get()).data() as { projectionContentHash: string; lastChangeSequence: number };
    assert.equal(head.sourceHash, stored.projectionContentHash, "the head now represents the authoritative document");
    assert.equal(stored.lastChangeSequence, SEQ);
    const putsBefore = store.puts.length;
    const hit = await getCpuProjectionPackage(date, date);
    assert.ok(hit, "a later read is served from the repaired package");
    assert.equal((hit!.value.projection as { authorityBindingVersion?: number }).authorityBindingVersion, 1);
    assert.equal(store.puts.length, putsBefore, "reading does not publish anything");
  } finally { globalThis.fetch = realFetch; }
});

// ---- review round: settle-on-winner must still honour the authoritative-document CAS; predecessor must be internally consistent ---------
test("settle-on-winner cannot bypass the authoritative-document CAS: if the document changed after the winner promoted, the loser is STALE, not 'recovered'", opts, async () => {
  const date = nextWeek();
  const seed = await seedDivergence("week", date);
  const hashX = cpuProjectionContentHash(seed.newProjection);
  const version = seed.oldManifest.packageVersion + 1;
  const encodeX = () => encodeReadPackage("snapshots/cpu-production/projection-week", version, { projection: seed.newProjection }, 2, {
    contractVersion: "cpu-production.projection.v1", sourceVersion: `cpu-change-${SEQ}`, sourceHash: hashX, scope: `week:${date}`,
  });
  // Y: the authoritative document changes again, still at sequence N
  const projectionY = weekProjection(date, [order(`production-order:v1:menu-planning:${run}:Y-${date}`, date)]);
  let winner: { packageVersion: number; objectName: string } | undefined;
  // recoverers A and B both observed the old head + document X. A promotes X, the document becomes Y, THEN B reaches its final transaction.
  store.onPut = async () => {
    store.onPut = undefined;
    winner = await publishMonotonicCpuPackage(store, seed.key, encodeX(), hashX, { divergenceRecovery: { authoritativeDocumentId: seed.id } });
    await setDocument(seed.id, projectionY as never);
  };
  await assert.rejects(
    () => publishMonotonicCpuPackage(store, seed.key, encodeX(), hashX, { divergenceRecovery: { authoritativeDocumentId: seed.id } }),
    (error: { code?: string }) => error.code === "CPU_PACKAGE_RECOVERY_STALE",
    "B must NOT return A's package as a successful recovery once the document no longer holds X",
  );
  assert.ok(winner, "A did promote X");
  const head = (await readHead(seed.key))!;
  assert.equal(head.manifest.objectName, winner!.objectName, "B did not alter the head A promoted");
  // the document now holds Y while the head holds X: the next recovery (for Y) is a fresh, separately validated promotion
  const next = await publishCpuProjectionPackage(projectionY, { authoritativeDivergenceRecovery: true });
  assert.ok(next.packageVersion > version);
  assert.equal((await readHead(seed.key))!.sourceHash, cpuProjectionContentHash(projectionY));
});

for (const variant of ["head source hash", "manifest source hash", "manifest sequence"] as const) {
  test(`recovery predecessor hardening: a package with valid bytes but inconsistent ${variant} metadata is never used as a predecessor`, opts, async () => {
    const date = nextWeek();
    const seed = await seedDivergence("week", date);
    const head = (await readHead(seed.key))!;
    const tampered = structuredClone(head);
    if (variant === "head source hash") tampered.sourceHash = "f".repeat(64);
    if (variant === "manifest source hash") tampered.manifest.sourceHash = "e".repeat(64);
    if (variant === "manifest sequence") tampered.manifest.sourceVersion = `cpu-change-${SEQ - 1}`;
    await headRef(seed.key).set(tampered);
    const putsBefore = store.puts.length;
    await assert.rejects(
      () => publishCpuProjectionPackage(seed.newProjection, { authoritativeDivergenceRecovery: true }),
      (error: { code?: string }) => variant === "manifest sequence" ? true : error.code === "CPU_PACKAGE_RECOVERY_PREDECESSOR_INCONSISTENT",
    );
    assert.deepEqual(await readHead(seed.key), tampered, "nothing was promoted");
    assert.equal(store.puts.length, putsBefore, "nothing was published");
  });
}
