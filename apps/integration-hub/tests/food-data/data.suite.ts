import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { decodeBundle, validateBundle } from "../../lib/food-data/bundle";
import { buildIngredientIndex, buildIngredientRecords, computePackPricing } from "../../lib/food-data/ingredients";
import { buildRecipeIndex, buildRecipeRecords } from "../../lib/food-data/recipes";
import { FoodDataError, datasetVersion, parseManifest } from "../../lib/food-data/manifest";
import { INGREDIENT_COLUMNS } from "./columns";
import { defaultFiles, ingredientRow, makeFile, makeManifest } from "./fixtures";

const decode = async (dataset: "ingredients" | "recipes", file = defaultFiles()[dataset], snapshot = "2026-10-31") => decodeBundle(dataset, file.gzip, file.entry, snapshot);

test("food data: positional rows map to columns by header name and preserve source strings", async () => {
  const records = buildIngredientRecords(await decode("ingredients"));
  assert.equal(records.length, 4);
  assert.equal(records[0].name, "Plain Flour 16kg");
  assert.equal(records[0].supplierCode, "00123", "leading zeros survive: supplier codes are strings");
  assert.equal(typeof records[0].supplierCode, "string");
  assert.equal(records[1].productCode, "", "empty fields stay empty");
  assert.equal(records[0].declaration, "Wheat Flour");
  assert.equal(records[0].allergens.find(entry => entry.allergen === "Gluten Source Wheat")?.value, "Y");
  assert.equal(records[2].index, 2); assert.equal(records[3].index, 3, "exact duplicate source rows are both kept");
});

test("food data: a wholly blank allergen block is not-recorded, never clear", async () => {
  const records = buildIngredientRecords(await decode("ingredients"));
  assert.equal(records[0].allergensRecorded, true);
  assert.equal(records[2].allergensRecorded, false);
});

test("food data: required columns missing from a payload fail loudly", () => {
  const columns = INGREDIENT_COLUMNS.filter(column => column !== "Supplier Code");
  assert.throws(() => buildIngredientRecords({ schemaVersion: 1, dataset: "ingredients", snapshot: "2026-10-31", columns, rows: [] }), /Supplier Code/);
});

test("food data: product and supplier search and filters", async () => {
  const index = buildIngredientIndex(buildIngredientRecords(await decode("ingredients")));
  const names = (positions: number[]) => positions.map(position => index.records[position].name);
  assert.deepEqual(names(index.search({ text: "flour" })), ["Plain Flour 16kg"]);
  assert.deepEqual(names(index.search({ text: "test dairy", field: "supplier" })).length, 3);
  assert.deepEqual(names(index.search({ text: "00123", field: "supplierCode" })), ["Plain Flour 16kg"]);
  assert.deepEqual(names(index.search({ text: "9", field: "supplierCode" })).length, 3, "substring match across string codes (9, 0009)");
  assert.deepEqual(names(index.search({ text: "pf-16", field: "productCode" })), ["Plain Flour 16kg"]);
  assert.deepEqual(names(index.search({ text: "mill co", field: "brand" })), ["Plain Flour 16kg"]);
  assert.deepEqual(names(index.search({ category: "Dairy" })), ["Whole Milk 2l"]);
  assert.equal(index.search({ status: "Delisted" }).length, 2);
  assert.equal(index.search({ supplier: "Test Dairy", status: "Active" }).length, 1);
  assert.equal(index.search({ text: "no such thing" }).length, 0);
  assert.equal(index.search({}).length, 4, "empty query lists everything in stable name order");
  assert.deepEqual(index.suppliers, ["Test Dairy", "Test Mill"]);
});

test("food data: VAT-inclusive prices, ex-VAT and safe unit costs", () => {
  const flour = computePackPricing("16", "kg", "12", "20");
  assert.equal(flour.priceIncVat, 12); assert.equal(flour.priceExVat, 10);
  assert.deepEqual(flour.unitCost, { per: "kg", incVat: 0.75, exVat: 0.625 });
  const milk = computePackPricing("2000", "ml", "1.5", "0");
  assert.equal(milk.priceExVat, 1.5); assert.equal(milk.unitCost?.per, "litre"); assert.equal(milk.unitCost?.incVat, 0.75);
  assert.equal(computePackPricing("500", "g", "2", "20").unitCost?.incVat, 4);
  assert.equal(computePackPricing("1", "pack", "5", "20").unitCost, null, "no invented conversion for packs");
  assert.match(computePackPricing("1", "ea", "5", "20").unitCostNote, /cannot be converted/);
  assert.equal(computePackPricing("", "kg", "5", "20").unitCost, null);
  assert.equal(computePackPricing("0", "kg", "5", "20").unitCost, null);
  assert.equal(computePackPricing("2", "kg", "", "20").priceIncVat, null);
  const noVat = computePackPricing("2", "kg", "4", "");
  assert.equal(noVat.priceExVat, null); assert.equal(noVat.unitCost?.exVat, null); assert.equal(noVat.unitCost?.incVat, 2);
  assert.equal(computePackPricing("1e3", "kg", "4", "20").packQuantity, null, "only plain decimals are parsed");
});

test("food data: duplicate and conflicting recipe records stay visible", async () => {
  const bundle = await decode("recipes");
  const records = buildRecipeRecords(bundle);
  assert.equal(records.length, 4, "every exported row is retained");
  const index = buildRecipeIndex(records, bundle.columns);
  assert.equal(index.groups.length, 2);
  const soup = index.groups.find(group => group.name === "Tomato Soup")!;
  assert.deepEqual(soup.members, [0, 1, 2]);
  assert.equal(soup.exactDuplicateRows, 1);
  assert.deepEqual(soup.conflicts.map(conflict => conflict.column), ["Recipe cost"]);
  assert.deepEqual(soup.conflicts[0].values, ["0.50", "0.55"]);
  assert.equal(index.groups.find(group => group.name === "Lemon Cake")!.conflicts.length, 0);
  assert.deepEqual(index.search("soup").map(group => group.name), ["Tomato Soup"]);
  assert.equal(index.search("").length, 2);
  assert.ok(records[0].flags.includes("Additive free"));
  assert.equal(records[0].allergens.find(entry => entry.allergen === "Celery/ Celeriac")?.value, "Y");
});

test("food data: gzip and JSON checksums are enforced", async () => {
  const good = defaultFiles().ingredients;
  const flipped = Buffer.from(good.gzip); flipped[flipped.length - 12] ^= 0xff;
  await assert.rejects(decodeBundle("ingredients", flipped, good.entry, "2026-10-31"), (error: FoodDataError) => error.code === "FOOD_DATA_INTEGRITY_FAILED");
  await assert.rejects(decodeBundle("ingredients", good.gzip.subarray(0, 40), good.entry, "2026-10-31"), (error: FoodDataError) => error.code === "FOOD_DATA_INTEGRITY_FAILED");
  // Valid gzip whose JSON differs from the manifest's JSON hash.
  const other = makeFile("ingredients", [ingredientRow({ "Product Name": "Other" })]);
  const lying = { ...good.entry, gzipBytes: other.gzip.length, gzipSha256: other.entry.gzipSha256 };
  await assert.rejects(decodeBundle("ingredients", other.gzip, lying, "2026-10-31"), (error: FoodDataError) => error.code === "FOOD_DATA_INTEGRITY_FAILED");
  // A gzip bomb is cut off at the declared size.
  const bomb = gzipSync(Buffer.alloc(5_000_000, 32));
  await assert.rejects(decodeBundle("ingredients", bomb, { ...good.entry, gzipBytes: bomb.length, gzipSha256: (await import("node:crypto")).createHash("sha256").update(bomb).digest("hex") }, "2026-10-31"), /expands beyond/);
});

test("food data: schema validation rejects malformed payloads", () => {
  const { entry } = defaultFiles().ingredients;
  const valid = { schemaVersion: 1, dataset: "ingredients", snapshot: "2026-10-31", columns: INGREDIENT_COLUMNS, rows: defaultFiles().ingredients.json.length ? JSON.parse(defaultFiles().ingredients.json.toString()).rows : [] };
  assert.doesNotThrow(() => validateBundle("ingredients", valid, entry, "2026-10-31"));
  const bad = (patch: Record<string, unknown>) => () => validateBundle("ingredients", { ...valid, ...patch }, entry, "2026-10-31");
  assert.throws(bad({ schemaVersion: 2 }), /schema version/);
  assert.throws(bad({ dataset: "recipes" }), /dataset/);
  assert.throws(bad({ snapshot: "2026-11-30" }), /snapshot/);
  assert.throws(bad({ columns: INGREDIENT_COLUMNS.slice(1) }), /columns/);
  assert.throws(bad({ rows: valid.rows.slice(1) }), /rows/);
  assert.throws(bad({ rows: [valid.rows[0].slice(1), ...valid.rows.slice(1)] }), /positional/);
  assert.throws(bad({ rows: [[...valid.rows[0].slice(1), 5], ...valid.rows.slice(1)] }), /non-text/);
  assert.throws(bad({ rows: { not: "an array" } }), /rows/);
});

test("food data: manifest is a fixed snapshot with independent per-dataset versions", () => {
  const files = defaultFiles();
  const manifest = makeManifest(files);
  assert.equal(manifest.pricing.priceEffectiveDate, null, "unknown stays unknown");
  const ingredientVersion = datasetVersion(manifest, "ingredients"); const recipeVersion = datasetVersion(manifest, "recipes");
  assert.notEqual(ingredientVersion, recipeVersion);
  const changed = makeManifest({ ...files, ingredients: makeFile("ingredients", [ingredientRow({ "Product Name": "Changed" })]) });
  assert.notEqual(datasetVersion(changed, "ingredients"), ingredientVersion);
  assert.equal(datasetVersion(changed, "recipes"), recipeVersion, "recipes keep their version when only ingredients change");
  const raw = JSON.parse(JSON.stringify({ schemaVersion: 1, snapshot: "2026-10-31", files: { ingredients: manifest.files.ingredients, recipes: manifest.files.recipes } }));
  assert.throws(() => parseManifest({ ...raw, snapshot: "latest" }), FoodDataError);
  assert.throws(() => parseManifest({ ...raw, files: { ...raw.files, recipes: { ...raw.files.recipes, object: "../secrets.json.gz" } } }), FoodDataError);
  assert.throws(() => parseManifest({ ...raw, files: { ...raw.files, recipes: { ...raw.files.recipes, gzipSha256: "abc" } } }), FoodDataError);
});
