import assert from "node:assert/strict";
import test from "node:test";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import {
  cachedAuthmodReference,
  clearAuthmodReferenceCachesForTests,
  invalidateAuthmodReferenceCaches,
} from "../lib/authmod-reference-cache";

test.beforeEach(() => {
  clearAuthmodReferenceCachesForTests();
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
});

test.afterEach(() => {
  clearAuthmodReferenceCachesForTests();
  delete process.env.FIKA_DATA_SOURCE_TRACE;
});

test("deduplicates concurrent loads and records a warm APP_CACHE hit", async () => {
  let loads = 0;
  let resolve: ((value: string[]) => void) | undefined;
  const pending = new Promise<string[]>(r => { resolve = r; });
  const load = () => { loads += 1; return pending; };
  const messages: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try {
    const first = cachedAuthmodReference({ scope: "admin:a", name: "listLegendReferences", load, documents: value => value.length });
    const second = cachedAuthmodReference({ scope: "admin:a", name: "listLegendReferences", load, documents: value => value.length });
    assert.equal(loads, 1);
    resolve!(["legend-1", "legend-2"]);
    assert.deepEqual(await Promise.all([first, second]), [["legend-1", "legend-2"], ["legend-1", "legend-2"]]);
    await withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.options.load" }, async () => {
      assert.deepEqual(await cachedAuthmodReference({ scope: "admin:a", name: "listLegendReferences", load, documents: value => value.length }), ["legend-1", "legend-2"]);
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(loads, 1);
  assert.ok(messages.some(message => message.includes('"source":"APP_CACHE"') && message.includes('"cacheHit":true')));
});

test("keeps reference data isolated by authorized-admin scope", async () => {
  let loads = 0;
  const load = async () => [`value-${++loads}`];
  assert.deepEqual(await cachedAuthmodReference({ scope: "admin:a", name: "listApplications", load, documents: value => value.length }), ["value-1"]);
  assert.deepEqual(await cachedAuthmodReference({ scope: "admin:b", name: "listApplications", load, documents: value => value.length }), ["value-2"]);
  assert.deepEqual(await cachedAuthmodReference({ scope: "admin:a", name: "listApplications", load, documents: value => value.length }), ["value-1"]);
  assert.equal(loads, 2);
});

test("invalidates cached references after a mutation", async () => {
  let loads = 0;
  const load = async () => [`version-${++loads}`];
  const input = { scope: "admin:a", name: "listActiveOplocs", load, documents: (value: string[]) => value.length };
  assert.deepEqual(await cachedAuthmodReference(input), ["version-1"]);
  assert.deepEqual(await cachedAuthmodReference(input), ["version-1"]);
  invalidateAuthmodReferenceCaches();
  assert.deepEqual(await cachedAuthmodReference(input), ["version-2"]);
  assert.equal(loads, 2);
});

test("does not retain a result that completes after invalidation", async () => {
  let resolve: ((value: string[]) => void) | undefined;
  const pending = new Promise<string[]>(r => { resolve = r; });
  const first = cachedAuthmodReference({ scope: "admin:a", name: "listApplications", load: () => pending, documents: value => value.length });
  invalidateAuthmodReferenceCaches();
  resolve!(["stale"]);
  await first;
  let freshLoads = 0;
  assert.deepEqual(await cachedAuthmodReference({ scope: "admin:a", name: "listApplications", load: async () => { freshLoads += 1; return ["fresh"]; }, documents: value => value.length }), ["fresh"]);
  assert.equal(freshLoads, 1);
});
