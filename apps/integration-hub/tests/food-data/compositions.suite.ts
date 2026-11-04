import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { decodeCompositionBundle, parseCompositionManifest, reconcileCompositionBundle, validateCompositionBundle, type CompositionBundle } from "../../lib/food-data/compositions";
import type { IngredientRecord } from "../../lib/food-data/ingredients";
import { createCompositionLoader } from "../../lib/food-data/composition-loader";
import { memoryFoodBundleStore } from "../../lib/food-data/cache";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const bundle: CompositionBundle = {
    schemaVersion: 2, dataset: "kafoodle-recipe-compositions", exportDate: "2026-11-03", sourceFile: "export.csv", sourceCsvSha256: "c".repeat(64),
    sourceColumns: ["Recipe Name", "Reference", "List", "Ingredient - name", "Ingredient - Ingredient/Recipe id", "Ingredient - quantity", "Ingredient - UoM [g, ml, etc]"], sourceRows: 3,
    labelSafetyStatus: "NOT_APPROVED_FOR_FOOD_LABELS",
    recipes: [
      { sourceGroupIndex: 0, sourceRowStart: 2, sourceRowEnd: 3, recipeName: "Soup", reference: "R-1", list: "Lunch", metadata: { "Step 1": "Simmer", "Step 2": "" }, lines: [
        { sourceRow: 2, ingredientName: "Flour", ingredientId: "K-1", supplierCode: "0001", supplierName: "Mill", quantityRaw: "2", unitRaw: "kg" },
        { sourceRow: 3, ingredientName: "Tomato", ingredientId: "K-2", supplierCode: "missing", supplierName: "Farm", quantityRaw: "1", unitRaw: "case" },
      ] },
      { sourceGroupIndex: 1, sourceRowStart: 4, sourceRowEnd: 4, recipeName: "Soup", reference: "R-2", list: "Dinner", metadata: {}, lines: [
        { sourceRow: 4, ingredientName: "Soup base", ingredientId: "R-1", supplierCode: "", supplierName: "", quantityRaw: "1", unitRaw: "serving" },
      ] },
    ],
  };
  const json = Buffer.from(JSON.stringify(bundle)); const gzip = gzipSync(json);
  const manifest = parseCompositionManifest({ schemaVersion: 2, dataset: bundle.dataset, exportDate: bundle.exportDate, file: {
    object: "recipe-compositions.json.gz", sourceCsvSha256: bundle.sourceCsvSha256, sourceCsvFilename: "export.csv", columns: bundle.sourceColumns.length,
    sourceRows: 3, recipeGroups: 2, distinctRecipeNames: 1, jsonBytes: json.length, gzipBytes: gzip.length, jsonSha256: sha(json), gzipSha256: sha(gzip), status: "unreviewed", labelSafetyStatus: bundle.labelSafetyStatus,
  } });
  return { bundle, manifest, json, gzip };
}

test("composition v2: hashes, groups, source order and raw units survive decode", async () => {
  const f = fixture();
  const decoded = await decodeCompositionBundle(f.gzip, f.manifest);
  assert.equal(decoded.recipes.length, 2, "same-name groups remain distinct by source identity");
  assert.equal(decoded.recipes[0].lines[1].unitRaw, "case", "non-standard unit remains raw");
  assert.deepEqual(decoded.recipes.flatMap(group => group.lines.map(line => line.sourceRow)), [2, 3, 4]);
  const changed = Buffer.from(f.gzip); changed[changed.length - 8] ^= 0xff;
  await assert.rejects(decodeCompositionBundle(changed, f.manifest), /SHA-256/);
});

test("composition v2: malformed schema, row gaps and manifest drift fail closed", () => {
  const f = fixture();
  assert.throws(() => parseCompositionManifest({ ...f.manifest, file: { ...f.manifest.file, gzipSha256: "abc" } }), /manifest entry/);
  assert.throws(() => validateCompositionBundle({ ...f.bundle, recipes: [{ ...f.bundle.recipes[0], sourceRowStart: 3 }] }, f.manifest), /manifest|malformed|contiguous/);
  assert.throws(() => validateCompositionBundle({ ...f.bundle, sourceRows: 2 }, f.manifest), /manifest/);
  assert.throws(() => validateCompositionBundle({ ...f.bundle, sourceColumns: ["missing"] }, f.manifest), /manifest/);
});

test("composition v2: supplier-code reconciliation is unique-only and preserves unresolved and nested references", () => {
  const f = fixture();
  const product = (supplierCode: string, name: string) => ({ supplierCode, name, index: 0, supplier: "Mill", productCode: "", brand: "", category: "", status: "", locked: "", customerFacingName: "", origin: "", declaration: "", linkedRecipeName: "", pricing: {} as IngredientRecord["pricing"], allergens: [], allergensRecorded: false, nutrition: [], diets: [] }) as IngredientRecord;
  const result = reconcileCompositionBundle(f.bundle, [product("0001", "Different label"), product("dupe", "One"), product("dupe", "Two")]);
  assert.deepEqual(result.counts, { matched: 1, ambiguous: 0, missing: 1, nestedRecipe: 1 });
  assert.equal(result.groups[0].lines[0].match.status, "matched", "matching does not depend on the product name");
  assert.equal(result.groups[0].lines[1].match.status, "missing", "name similarity never creates a link");
  assert.equal(result.groups[1].lines[0].match.status, "nested-recipe");
  const ambiguous = reconcileCompositionBundle({ ...f.bundle, recipes: [f.bundle.recipes[0]] }, [product("0001", "A"), product("0001", "B")]);
  assert.equal(ambiguous.counts.ambiguous, 1);
});

test("composition v2: cache is versioned, reverified and invalidated after an access refusal", async () => {
  const f = fixture(); const store = memoryFoodBundleStore(); let denied = false; let bundleRequests = 0;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith("/manifest")) return denied ? new Response("{}", { status: 403 }) : Response.json({ identityScope: "staff:a", manifest: f.manifest });
    bundleRequests++; return new Response(f.gzip, { status: 200 });
  };
  const loader = createCompositionLoader({ fetch: fetcher, store, environment: "https://hub.test", now: () => new Date("2026-11-04T10:00:00Z") });
  assert.equal((await loader.load()).source, "downloaded");
  assert.equal((await loader.load()).source, "cache");
  assert.equal(bundleRequests, 1);
  assert.equal(store.records.size, 1);
  denied = true;
  await assert.rejects(loader.load(), /active staff account/);
  assert.equal(store.records.size, 0, "cached composition bytes are deleted when access is refused");
});
