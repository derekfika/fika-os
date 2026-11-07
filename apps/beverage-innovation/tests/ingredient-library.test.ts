import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { sha256 } from "@fika/server-shared/read-package";
import { GET } from "../app/api/ingredient-library/route";
import { createIngredientLibrary, ingredientLibraryColumns } from "../lib/ingredient-library";
import { beveragePreviewRouteDecision } from "../lib/preview-routing";

const columns = Object.values(ingredientLibraryColumns);
const snapshot = "2026-11-07";
const record = ["Vanilla concentrate", "Fixture Supplier", "VAN-01", "0009", "Fixture Pantry", "Syrups", "Delisted"];

function syntheticSnapshot(overrides: Record<string, unknown> = {}) {
  const bundle = { schemaVersion: 1, dataset: "ingredients", snapshot, columns, rows: [record], ...overrides };
  const json = Buffer.from(JSON.stringify(bundle));
  const gzip = gzipSync(json);
  const entry = {
    columns: columns.length, rows: 1, gzipBytes: gzip.byteLength, jsonBytes: json.byteLength, gzipSha256: sha256(gzip), jsonSha256: sha256(json),
  };
  return { manifest: { schemaVersion: 1, snapshot, files: { ingredients: entry } }, gzip, version: `${snapshot}:${entry.gzipSha256}` };
}

test("Beverage reads the same fictional Hub v1 bytes and keeps distinct source rows and code text", async () => {
  // Test-only contract check. The Beverage runtime does not import the sibling app.
  const { defaultFiles, makeManifest } = await import(new URL("../../integration-hub/tests/food-data/fixtures.ts", import.meta.url).href);
  const { decodeBundle } = await import(new URL("../../integration-hub/lib/food-data/bundle.ts", import.meta.url).href);
  const { datasetVersion } = await import(new URL("../../integration-hub/lib/food-data/manifest.ts", import.meta.url).href);
  const files = defaultFiles();
  const manifest = makeManifest(files);
  const canonical = await decodeBundle("ingredients", files.ingredients.gzip, manifest.files.ingredients, manifest.snapshot);
  assert.equal(canonical.rows.length, 4);
  const library = createIngredientLibrary(manifest, files.ingredients.gzip, datasetVersion(manifest, "ingredients"));
  const matches = library.search("TEST DAIRY 0009", 50);
  assert.equal(matches.matchCount, 2);
  assert.deepEqual(matches.products.map(row => row.sourceRowIndex), [2, 3]);
  assert.equal(matches.products[0].supplierCode, "0009");
  assert.equal(matches.products[0].purchaseStatus, "Delisted");
  assert.deepEqual(Object.keys(matches.products[0]).sort(), ["sourceRowIndex", ...Object.keys(ingredientLibraryColumns)].sort());
  assert.deepEqual(library.source, { dataset: "ingredients", snapshot: manifest.snapshot, version: datasetVersion(manifest, "ingredients") });
});

test("wrong versions, corrupt or oversized evidence, and ambiguous positional columns fail closed", () => {
  const { manifest, gzip, version } = syntheticSnapshot();
  assert.throws(() => createIngredientLibrary(manifest, gzip, `${snapshot}:${"0".repeat(64)}`), { code: "BEVERAGE_INGREDIENT_VERSION_CHANGED" });
  const corrupted = Buffer.from(gzip);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => createIngredientLibrary(manifest, corrupted, version), { code: "BEVERAGE_INGREDIENT_SNAPSHOT_INVALID" });

  const original = manifest.files.ingredients;
  for (const entry of [
    { ...original, jsonSha256: "0".repeat(64) },
    { ...original, jsonBytes: original.jsonBytes - 1 },
    { ...original, jsonBytes: 40 * 1024 * 1024 + 1 },
    { ...original, gzipBytes: 5 * 1024 * 1024 + 1 },
    { ...original, rows: 25_001 },
  ]) {
    assert.throws(() => createIngredientLibrary({ ...manifest, files: { ingredients: entry } }, gzip, version), { code: "BEVERAGE_INGREDIENT_SNAPSHOT_INVALID" });
  }
  for (const overrides of [
    { dataset: "recipes" },
    { snapshot: "2026-11-06" },
    { columns: [columns[0], ...columns.slice(0, -1)] },
    { rows: [record.slice(1)] },
    { rows: [[...record.slice(0, -1), 1]] },
  ]) {
    const malformed = syntheticSnapshot(overrides);
    assert.throws(() => createIngredientLibrary(malformed.manifest, malformed.gzip, malformed.version), { code: "BEVERAGE_INGREDIENT_SNAPSHOT_INVALID" });
  }
});

test("the projection keeps original row indices, bounds responses and never infers a cost or allergen", () => {
  const fixture = syntheticSnapshot({ rows: [record.map(() => ""), ...Array.from({ length: 52 }, () => record)] });
  fixture.manifest.files.ingredients.rows = 53;
  const library = createIngredientLibrary(fixture.manifest, fixture.gzip, fixture.version);
  const matches = library.search("van-01", 500);
  assert.equal(matches.matchCount, 52);
  assert.equal(matches.products.length, 50);
  assert.equal(matches.products[0].sourceRowIndex, 1);
  assert.equal(matches.products[49].sourceRowIndex, 50);
  assert.equal(library.search("missing product", 20).matchCount, 0);
});

test("ingredient GET is fixture-only, permissioned and no-store", async t => {
  const config: Record<string, string | undefined> = {
    NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8294", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIKA_LOCAL_GOOGLE_AUTH: undefined, FIKA_BEVERAGE_LOCAL_AUTH: "fixture", FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS: "View",
    FIKA_BEVERAGE_LOCAL_OPLOC_IDS: undefined, FIKA_BEVERAGE_LOCAL_ACTOR_ID: undefined,
  };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  const restore = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  restore(config);
  t.after(() => restore(previous));
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("The fixture route must not call upstreams."); });
  const endpoint = "http://localhost:13617/api/ingredient-library";

  const response = await GET(new Request(`${endpoint}?q=0009&limit=1`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.fixture, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.matchCount, 2);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, "Juniper soda");
  assert.equal(result.products[0].sourceRowIndex, 0);

  for (const query of ["limit=51", "limit=0", "limit=2&limit=3", "q=1&q=2", "source=https://hub.example.test"]) {
    assert.equal((await GET(new Request(`${endpoint}?${query}`))).status, 400);
  }
  assert.equal((await GET(new Request(endpoint, { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  assert.equal((await GET(new Request(endpoint.replace("localhost", "example.test")))).status, 403);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "Contribute";
  assert.equal((await GET(new Request(endpoint))).status, 403);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  process.env.FIKA_RUNTIME_MODE = "staging";
  assert.equal((await GET(new Request(endpoint))).status, 503);
  assert.equal(beveragePreviewRouteDecision("/api/ingredient-library", "beverage-staging.example.test", {
    NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_BEVERAGE_PREVIEW_ONLY: "1",
  }), "hide-api");
  assert.equal(fetch.mock.callCount(), 0);
});
