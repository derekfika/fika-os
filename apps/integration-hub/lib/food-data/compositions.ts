import { gunzipBounded, sha256Hex } from "./bundle";
import { FoodDataError, type FoodFileEntry } from "./manifest";
import type { IngredientRecord } from "./ingredients";

export const COMPOSITION_DATASET = "kafoodle-recipe-compositions" as const;
export const COMPOSITION_SNAPSHOT = "2026-11-03" as const;
export const COMPOSITION_LABEL_SAFETY = "NOT_APPROVED_FOR_FOOD_LABELS" as const;

export type CompositionFileEntry = {
  object: "recipe-compositions.json.gz";
  sourceCsvSha256: string;
  sourceCsvFilename: string;
  columns: number;
  sourceRows: number;
  recipeGroups: number;
  distinctRecipeNames: number;
  jsonBytes: number;
  gzipBytes: number;
  jsonSha256: string;
  gzipSha256: string;
  status: "unreviewed";
  labelSafetyStatus: typeof COMPOSITION_LABEL_SAFETY;
};
export type CompositionManifest = {
  schemaVersion: 2;
  dataset: typeof COMPOSITION_DATASET;
  exportDate: string;
  file: CompositionFileEntry;
};
export type CompositionLine = {
  sourceRow: number;
  ingredientName: string;
  ingredientId: string;
  supplierCode: string;
  supplierName: string;
  quantityRaw: string;
  unitRaw: string;
};
export type CompositionGroup = {
  sourceGroupIndex: number;
  sourceRowStart: number;
  sourceRowEnd: number;
  recipeName: string;
  reference: string;
  list: string;
  metadata: Record<string, string>;
  lines: CompositionLine[];
};
export type CompositionBundle = {
  schemaVersion: 2;
  dataset: typeof COMPOSITION_DATASET;
  exportDate: string;
  sourceFile: string;
  sourceCsvSha256: string;
  sourceColumns: string[];
  sourceRows: number;
  recipes: CompositionGroup[];
  labelSafetyStatus: typeof COMPOSITION_LABEL_SAFETY;
};
export type IngredientMatch =
  | { status: "matched"; candidate: IngredientRecord }
  | { status: "ambiguous"; candidates: IngredientRecord[] }
  | { status: "missing"; candidates: [] }
  | { status: "nested-recipe"; candidates: [] };

const HASH = /^[a-f0-9]{64}$/;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const schema = (message: string): never => { throw new FoodDataError(message, "FOOD_DATA_SCHEMA_INVALID", 502); };
const integrity = (message: string): never => { throw new FoodDataError(message, "FOOD_DATA_INTEGRITY_FAILED", 502); };

export function parseCompositionManifest(value: unknown): CompositionManifest {
  if (!record(value) || value.schemaVersion !== 2 || value.dataset !== COMPOSITION_DATASET || value.exportDate !== COMPOSITION_SNAPSHOT || !record(value.file)) {
    throw new FoodDataError("Recipe composition manifest is invalid.", "FOOD_DATA_MANIFEST_INVALID", 502);
  }
  const f = value.file;
  if (f.object !== "recipe-compositions.json.gz" || !integer(f.columns) || !integer(f.sourceRows) || !integer(f.recipeGroups) || !integer(f.distinctRecipeNames) || !integer(f.jsonBytes) || !integer(f.gzipBytes)
    || typeof f.sourceCsvSha256 !== "string" || !HASH.test(f.sourceCsvSha256) || typeof f.jsonSha256 !== "string" || !HASH.test(f.jsonSha256)
    || typeof f.gzipSha256 !== "string" || !HASH.test(f.gzipSha256) || typeof f.sourceCsvFilename !== "string" || !f.sourceCsvFilename.trim()
    || f.status !== "unreviewed" || f.labelSafetyStatus !== COMPOSITION_LABEL_SAFETY) {
    throw new FoodDataError("Recipe composition manifest entry is invalid.", "FOOD_DATA_MANIFEST_INVALID", 502);
  }
  return { schemaVersion: 2, dataset: COMPOSITION_DATASET, exportDate: COMPOSITION_SNAPSHOT, file: f as unknown as CompositionFileEntry };
}

export function compositionVersion(manifest: CompositionManifest) { return `${manifest.exportDate}:${manifest.file.gzipSha256}`; }

export function compositionCacheEntry(manifest: CompositionManifest): FoodFileEntry {
  const file = manifest.file;
  return { object: file.object, sourceFile: file.sourceCsvFilename, columns: file.columns, rows: file.sourceRows, jsonBytes: file.jsonBytes, gzipBytes: file.gzipBytes, jsonSha256: file.jsonSha256, gzipSha256: file.gzipSha256 };
}

export async function decodeCompositionBundle(gzip: Uint8Array, manifest: CompositionManifest): Promise<CompositionBundle> {
  const entry = manifest.file;
  if (gzip.byteLength !== entry.gzipBytes || await sha256Hex(gzip) !== entry.gzipSha256) integrity("Recipe composition gzip failed its size or SHA-256 check.");
  const json = await gunzipBounded(gzip, entry.jsonBytes);
  if (json.byteLength !== entry.jsonBytes || await sha256Hex(json) !== entry.jsonSha256) integrity("Recipe composition JSON failed its size or SHA-256 check.");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)); } catch { return schema("Recipe composition data is not valid UTF-8 JSON."); }
  return validateCompositionBundle(value, manifest);
}

export function validateCompositionBundle(value: unknown, manifest: CompositionManifest): CompositionBundle {
  if (!record(value) || value.schemaVersion !== 2 || value.dataset !== COMPOSITION_DATASET || value.exportDate !== manifest.exportDate
    || value.sourceRows !== manifest.file.sourceRows || value.sourceCsvSha256 !== manifest.file.sourceCsvSha256
    || value.labelSafetyStatus !== COMPOSITION_LABEL_SAFETY || typeof value.sourceFile !== "string"
    || !Array.isArray(value.sourceColumns) || value.sourceColumns.length !== manifest.file.columns || !value.sourceColumns.every(x => typeof x === "string")
    || !Array.isArray(value.recipes) || value.recipes.length !== manifest.file.recipeGroups) return schema("Recipe composition payload does not match its v2 manifest.");
  const groups: CompositionGroup[] = [];
  let lineCount = 0;
  let nextSourceRow = 2;
  const names = new Set<string>();
  for (let i = 0; i < value.recipes.length; i++) {
    const group = value.recipes[i];
    if (!record(group) || group.sourceGroupIndex !== i || !integer(group.sourceRowStart) || !integer(group.sourceRowEnd)
      || (group.sourceRowStart as number) !== nextSourceRow || (group.sourceRowEnd as number) < (group.sourceRowStart as number) || (group.sourceRowEnd as number) > manifest.file.sourceRows + 1
      || typeof group.recipeName !== "string" || typeof group.reference !== "string" || typeof group.list !== "string"
      || !record(group.metadata) || !Object.values(group.metadata).every(x => typeof x === "string") || !Array.isArray(group.lines) || !group.lines.length) return schema(`Recipe composition group ${i + 1} is malformed.`);
    const sourceRowStart = group.sourceRowStart as number;
    const sourceRowEnd = group.sourceRowEnd as number;
    let previous = sourceRowStart - 1;
    const lines: CompositionLine[] = [];
    for (const line of group.lines) {
      if (!record(line) || !integer(line.sourceRow) || (line.sourceRow as number) <= previous || (line.sourceRow as number) < sourceRowStart || (line.sourceRow as number) > sourceRowEnd
        || !["ingredientName", "ingredientId", "supplierCode", "supplierName", "quantityRaw", "unitRaw"].every(k => typeof line[k] === "string")) return schema(`A source ingredient line in group ${i + 1} is malformed.`);
      previous = line.sourceRow as number;
      lines.push(line as unknown as CompositionLine);
    }
    if (lines[0].sourceRow !== sourceRowStart || lines[lines.length - 1].sourceRow !== sourceRowEnd || lines.length !== sourceRowEnd - sourceRowStart + 1) return schema(`Recipe composition group ${i + 1} does not preserve contiguous source rows.`);
    lineCount += lines.length;
    nextSourceRow = sourceRowEnd + 1;
    names.add(group.recipeName);
    groups.push(group as unknown as CompositionGroup);
  }
  if (lineCount !== manifest.file.sourceRows || nextSourceRow !== manifest.file.sourceRows + 2 || names.size !== manifest.file.distinctRecipeNames) return schema("Recipe composition row or distinct-name totals do not match the manifest.");
  return value as unknown as CompositionBundle;
}

/** Supplier code is the only ingredient key shared with the v1 product snapshot. Names never select a match. */
export function reconcileCompositionIngredient(line: CompositionLine, ingredients: readonly IngredientRecord[], recipeReferences: ReadonlySet<string>): IngredientMatch {
  return reconcileCompositionIngredientWithIndex(line, buildSupplierCodeIndex(ingredients), recipeReferences);
}

function buildSupplierCodeIndex(ingredients: readonly IngredientRecord[]) {
  const byCode = new Map<string, IngredientRecord[]>();
  for (const ingredient of ingredients) {
    const code = ingredient.supplierCode.trim();
    if (!code) continue;
    const candidates = byCode.get(code);
    if (candidates) candidates.push(ingredient);
    else byCode.set(code, [ingredient]);
  }
  return byCode;
}

function reconcileCompositionIngredientWithIndex(line: CompositionLine, byCode: ReadonlyMap<string, IngredientRecord[]>, recipeReferences: ReadonlySet<string>): IngredientMatch {
  const id = line.ingredientId.trim();
  const code = line.supplierCode.trim();
  if (!code) return id && recipeReferences.has(id) ? { status: "nested-recipe", candidates: [] } : { status: "missing", candidates: [] };
  const candidates = byCode.get(code) || [];
  if (candidates.length === 1) return { status: "matched", candidate: candidates[0] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "missing", candidates: [] };
}

export function reconcileCompositionBundle(bundle: CompositionBundle, ingredients: readonly IngredientRecord[]) {
  const references = new Set(bundle.recipes.map(recipe => recipe.reference.trim()).filter(Boolean));
  const byCode = buildSupplierCodeIndex(ingredients);
  const counts = { matched: 0, ambiguous: 0, missing: 0, nestedRecipe: 0 };
  const groups = bundle.recipes.map(recipe => ({ recipe, lines: recipe.lines.map(line => {
    const match = reconcileCompositionIngredientWithIndex(line, byCode, references);
    if (match.status === "nested-recipe") counts.nestedRecipe++;
    else counts[match.status]++;
    return { line, match };
  }) }));
  return { groups, counts, total: counts.matched + counts.ambiguous + counts.missing + counts.nestedRecipe };
}
