import assert from "node:assert/strict";
import test from "node:test";
import { cacheKey, memoryFoodBundleStore, type FoodBundleStore } from "../../lib/food-data/cache";
import { createFoodDataLoader } from "../../lib/food-data/loader";
import { datasetVersion } from "../../lib/food-data/manifest";
import { defaultFiles, ingredientRow, makeFile, makeManifest, type FixtureFile } from "./fixtures";

type Server = { files: Record<"ingredients" | "recipes", FixtureFile>; scope: string; manifestStatus: number; bundleStatus: number; down: boolean; requests: string[]; corrupt?: boolean };
function fakeServer(initial = defaultFiles()) {
  const server: Server = { files: initial, scope: "identity:a", manifestStatus: 200, bundleStatus: 200, down: false, requests: [] };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input); server.requests.push(url);
    if (server.down) throw new TypeError("network down");
    if (url.startsWith("/api/food-data/manifest")) {
      if (server.manifestStatus !== 200) return new Response(JSON.stringify({ error: "x" }), { status: server.manifestStatus });
      return new Response(JSON.stringify({ identityScope: server.scope, readOnly: true, manifest: makeManifest(server.files) }), { status: 200 });
    }
    const dataset = url.match(/bundle\/(ingredients|recipes)/)![1] as "ingredients" | "recipes";
    if (server.bundleStatus !== 200) return new Response("no", { status: server.bundleStatus });
    const body = server.corrupt ? Buffer.concat([server.files[dataset].gzip.subarray(0, 30), Buffer.alloc(30)]) : server.files[dataset].gzip;
    return new Response(new Uint8Array(body), { status: 200 });
  }) as typeof fetch;
  return { server, fetcher, downloads: () => server.requests.filter(url => url.includes("/bundle/")), manifests: () => server.requests.filter(url => url.includes("/manifest")) };
}
const harness = (store: FoodBundleStore = memoryFoodBundleStore(), fakes = fakeServer()) => ({ store, ...fakes, loader: () => createFoodDataLoader({ fetch: fakes.fetcher, store, environment: "https://hub.test" }) });
const ok = <T extends { ok: boolean }>(result: T) => { assert.equal(result.ok, true); return result as Extract<T, { ok: true }>; };

test("food data cache: cold visit downloads each bundle once, warm visits download none", async () => {
  const h = harness();
  const cold = await h.loader().load();
  assert.equal(ok(cold.results.ingredients).source, "downloaded"); assert.equal(ok(cold.results.recipes).source, "downloaded");
  assert.equal(ok(cold.results.ingredients).bundle.rows.length, 4);
  assert.equal(h.downloads().length, 2); assert.equal(h.manifests().length, 1);
  // Refresh / navigation = a new loader in a new page load, same browser profile.
  for (let visit = 0; visit < 3; visit++) {
    const warm = await h.loader().load();
    assert.equal(ok(warm.results.ingredients).source, "cache"); assert.equal(ok(warm.results.recipes).source, "cache");
  }
  assert.equal(h.downloads().length, 2, "no further bundle downloads");
  assert.equal(h.manifests().length, 4, "exactly one small manifest check per visit");
});

test("food data cache: version change downloads only the changed bundle", async () => {
  const h = harness(); await h.loader().load();
  h.server.files = { ...h.server.files, recipes: makeFile("recipes", [...JSON.parse(h.server.files.recipes.json.toString()).rows, JSON.parse(h.server.files.recipes.json.toString()).rows[0]]) };
  const before = h.downloads().length;
  const next = await h.loader().load();
  assert.equal(ok(next.results.ingredients).source, "cache"); assert.equal(ok(next.results.recipes).source, "downloaded");
  assert.deepEqual(h.downloads().slice(before).map(url => url.match(/bundle\/(\w+)/)![1]), ["recipes"]);
  assert.equal(ok(next.results.recipes).bundle.rows.length, 5);
});

test("food data cache: concurrent loads share one manifest check and one download per bundle", async () => {
  const h = harness(); const loader = h.loader();
  await Promise.all([loader.load(), loader.load(), loader.load()]);
  assert.equal(h.manifests().length, 1); assert.equal(h.downloads().length, 2);
});

test("food data cache: corrupt cached bytes are discarded and re-downloaded", async () => {
  const store = memoryFoodBundleStore(); const h = harness(store); await h.loader().load();
  const key = cacheKey("https://hub.test", "identity:a", "ingredients");
  const record = store.records.get(key)!; new Uint8Array(record.gzip)[20] ^= 0xff;
  const before = h.downloads().length;
  const again = await h.loader().load();
  assert.equal(ok(again.results.ingredients).source, "downloaded"); assert.equal(h.downloads().length - before, 1);
  // Malformed record shape (e.g. from an older schema) is treated the same way.
  store.records.set(key, { ...store.records.get(key)!, gzip: new ArrayBuffer(0) });
  assert.equal(ok((await h.loader().load()).results.ingredients).source, "downloaded");
});

test("food data cache: a download that fails its checksum is never stored or shown", async () => {
  const h = harness(); h.server.corrupt = true;
  const session = await h.loader().load();
  const failed = session.results.ingredients; assert.equal(failed.ok, false);
  assert.equal((failed as { code: string }).code, "FOOD_DATA_INTEGRITY_FAILED");
  assert.equal((h.store as ReturnType<typeof memoryFoodBundleStore>).records.size, 0);
});

test("food data cache: transient failure falls back to last-known-good once access is confirmed", async () => {
  const h = harness(); await h.loader().load();
  h.server.files = { ...h.server.files, ingredients: makeFile("ingredients", [ingredientRow({ "Product Name": "Newer" })], "2027-01-31") };
  h.server.bundleStatus = 503;
  // Manifest of a new snapshot: payload snapshot is 2027-01-31 so the manifest must say so too.
  const fakes = h; const original = fakes.server.files;
  const session = await createFoodDataLoader({ environment: "https://hub.test", store: h.store, fetch: (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/manifest")) return new Response(JSON.stringify({ identityScope: "identity:a", manifest: makeManifest(original, "2027-01-31") }));
    return new Response("busy", { status: 503 });
  }) as typeof fetch }).load();
  const stale = ok(session.results.ingredients);
  assert.equal(stale.source, "cache-stale"); assert.match(stale.warning!, /2026-10-31/); assert.equal(stale.bundle.rows.length, 4);
});

test("food data cache: failed first download with nothing cached is a clear error, other dataset still works", async () => {
  const h = harness();
  const base = h.fetcher;
  const loader = createFoodDataLoader({ environment: "x", store: h.store, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/bundle/recipes") ? new Response("no", { status: 500 }) : base(input, init)) as typeof fetch });
  const session = await loader.load();
  assert.equal(session.results.ingredients.ok, true); assert.equal(session.results.recipes.ok, false);
});

test("food data cache: quota exhaustion still serves the data and says it was not saved", async () => {
  const store = memoryFoodBundleStore(); store.put = async () => { throw new DOMException("full", "QuotaExceededError"); };
  const h = harness(store); const loader = h.loader();
  const session = await loader.load();
  const result = ok(session.results.ingredients);
  assert.equal(result.persisted, false); assert.match(result.warning!, /could not save/); assert.equal(result.bundle.rows.length, 4);
  assert.ok(loader.metrics.cacheFailures >= 2);
});

test("food data cache: unavailable storage degrades to downloading every time without throwing", async () => {
  const broken: FoodBundleStore = { get: async () => { throw new Error("unavailable"); }, put: async () => { throw new Error("unavailable"); }, delete: async () => { throw new Error("unavailable"); }, purgeOthers: async () => { throw new Error("unavailable"); }, clearAll: async () => { throw new Error("unavailable"); } };
  const h = harness(broken);
  assert.equal(ok((await h.loader().load()).results.ingredients).source, "downloaded");
});

test("food data authorisation: unauthorised, revoked or disabled access exposes nothing and clears the cache", async () => {
  for (const status of [401, 403, 404]) {
    const store = memoryFoodBundleStore(); const h = harness(store); await h.loader().load();
    assert.equal(store.records.size, 2);
    h.server.manifestStatus = status; const before = h.downloads().length;
    await assert.rejects(h.loader().load(), (error: { status: number }) => error.status === status);
    assert.equal(store.records.size, 0, `cache cleared on ${status}`);
    assert.equal(h.downloads().length, before, "no bundle requested after a refusal");
  }
});

test("food data authorisation: cached rows are never shown when the manifest check cannot confirm access", async () => {
  const store = memoryFoodBundleStore(); const h = harness(store); await h.loader().load();
  h.server.down = true;
  await assert.rejects(h.loader().load(), (error: { code: string }) => error.code === "FOOD_DATA_UNAVAILABLE");
  assert.equal(store.records.size, 2, "an outage alone does not destroy the cache");
});

test("food data identity: another identity never sees the first identity's cache and it is purged", async () => {
  const store = memoryFoodBundleStore(); const h = harness(store); await h.loader().load();
  h.server.scope = "identity:b";
  const before = h.downloads().length;
  const session = await h.loader().load();
  assert.equal(ok(session.results.ingredients).source, "downloaded"); assert.equal(h.downloads().length - before, 2);
  assert.deepEqual([...store.records.values()].map(record => record.identityScope), ["identity:b", "identity:b"]);
  // Same identity in another environment is isolated too.
  const other = createFoodDataLoader({ fetch: h.fetcher, store, environment: "https://other.test" });
  assert.equal(ok((await other.load()).results.recipes).source, "downloaded");
  assert.ok([...store.records.values()].every(record => record.environment === "https://other.test"));
});

test("food data cache: logout clear removes everything", async () => {
  const store = memoryFoodBundleStore(); const h = harness(store); const loader = h.loader(); await loader.load();
  await loader.clear(); assert.equal(store.records.size, 0);
});

test("food data cache: version string is snapshot plus gzip hash", () => {
  const manifest = makeManifest(defaultFiles());
  assert.equal(datasetVersion(manifest, "recipes"), `2026-10-31:${manifest.files.recipes.gzipSha256}`);
});
