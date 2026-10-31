import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { INGREDIENT_COLUMNS, RECIPE_COLUMNS } from "./columns";
import { parseManifest, type FoodDataset, type FoodManifest } from "../../lib/food-data/manifest";

/** Synthetic rows only: no real supplier or price data is committed. */
export function ingredientRow(values: Record<string, string>) { return INGREDIENT_COLUMNS.map(column => values[column] ?? ""); }
export function recipeRow(values: Record<string, string>) { return RECIPE_COLUMNS.map(column => values[column] ?? ""); }

export const SAMPLE_INGREDIENT_ROWS = [
  ingredientRow({ "Product Name": "Plain Flour 16kg", "Supplier Name": "Test Mill", "Supplier Code": "00123", "Product Code": "PF-16", "Category (365 Kitchen Management)": "Dry Goods", Brand: "Mill Co", "Gluten Source Wheat": "Y", Milk: "N", "Quantity (per Pack, Total)": "16", "UoM [g, ml, etc]": "kg", "Price inc VAT (£)": "12", "VAT %": "20", "Purchase Status": "Active", "Composite Ingredients": "Wheat Flour" }),
  ingredientRow({ "Product Name": "Whole Milk 2l", "Supplier Name": "Test Dairy", "Supplier Code": "9", "Category (365 Kitchen Management)": "Dairy", "Quantity (per Pack, Total)": "2000", "UoM [g, ml, etc]": "ml", "Price inc VAT (£)": "1.5", "VAT %": "0", Milk: "Y", "Purchase Status": "Active" }),
  ingredientRow({ "Product Name": "Mystery Box", "Supplier Name": "Test Dairy", "Supplier Code": "0009", "Quantity (per Pack, Total)": "1", "UoM [g, ml, etc]": "pack", "Price inc VAT (£)": "5", "VAT %": "20", "Purchase Status": "Delisted" }),
  ingredientRow({ "Product Name": "Mystery Box", "Supplier Name": "Test Dairy", "Supplier Code": "0009", "Quantity (per Pack, Total)": "1", "UoM [g, ml, etc]": "pack", "Price inc VAT (£)": "5", "VAT %": "20", "Purchase Status": "Delisted" }),
];
export const SAMPLE_RECIPE_ROWS = [
  recipeRow({ "Recipe Name": "Tomato Soup", "# Servings": "1", "Recipe cost": "0.50", Milk: "N", "Celery/ Celeriac": "Y", "Additive free": "Y" }),
  recipeRow({ "Recipe Name": "Tomato Soup", "# Servings": "1", "Recipe cost": "0.55", Milk: "N", "Celery/ Celeriac": "Y", "Additive free": "Y" }),
  recipeRow({ "Recipe Name": "Tomato Soup", "# Servings": "1", "Recipe cost": "0.55", Milk: "N", "Celery/ Celeriac": "Y", "Additive free": "Y" }),
  recipeRow({ "Recipe Name": "Lemon Cake", "# Servings": "12" }),
];

const sha = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");

export type FixtureFile = { gzip: Buffer; json: Buffer; entry: FoodManifest["files"][FoodDataset] };
export function makeFile(dataset: FoodDataset, rows: string[][], snapshot = "2026-10-31", overrides: Record<string, unknown> = {}): FixtureFile {
  const columns = dataset === "ingredients" ? INGREDIENT_COLUMNS : RECIPE_COLUMNS;
  const json = Buffer.from(JSON.stringify({ schemaVersion: 1, dataset, snapshot, columns, rows, ...overrides }));
  const gzip = gzipSync(json);
  return { gzip, json, entry: { object: `${dataset}.json.gz`, sourceFile: `${dataset}.csv`, columns: columns.length, rows: rows.length, jsonBytes: json.length, gzipBytes: gzip.length, jsonSha256: sha(json), gzipSha256: sha(gzip) } };
}

export function makeManifest(files: Record<FoodDataset, FixtureFile>, snapshot = "2026-10-31") {
  return parseManifest({ schemaVersion: 1, dataset: "kafoodle-export", snapshot, status: "test", pricing: { source: "Kafoodle export", updateFrequency: "quarterly", priceEffectiveDate: null, interpretation: "test" }, files: { ingredients: files.ingredients.entry, recipes: files.recipes.entry } });
}

export function defaultFiles() { return { ingredients: makeFile("ingredients", SAMPLE_INGREDIENT_ROWS), recipes: makeFile("recipes", SAMPLE_RECIPE_ROWS) }; }
