/**
 * Kafoodle Food Data — manifest contract.
 *
 * The manifest in the private catalogue bucket describes one fixed, immutable
 * import snapshot. It is NOT a live publication pointer: nothing here invents
 * "latest" or update versions. Each dataset is versioned independently by the
 * snapshot date plus the SHA-256 of its gzip payload.
 */
export const FOOD_DATASETS = ["ingredients", "recipes"] as const;
export type FoodDataset = (typeof FOOD_DATASETS)[number];

export type FoodFileEntry = {
  object: string;
  sourceFile: string;
  columns: number;
  rows: number;
  jsonBytes: number;
  gzipBytes: number;
  jsonSha256: string;
  gzipSha256: string;
};

export type FoodManifest = {
  schemaVersion: 1;
  dataset: string;
  snapshot: string;
  status: string;
  pricing: { source: string; updateFrequency: string; priceEffectiveDate: string | null; interpretation: string };
  files: Record<FoodDataset, FoodFileEntry>;
};

export type FoodDataErrorCode =
  | "FOOD_DATA_DISABLED"
  | "FOOD_DATA_UNAUTHENTICATED"
  | "FOOD_DATA_FORBIDDEN"
  | "FOOD_DATA_MANIFEST_INVALID"
  | "FOOD_DATA_VERSION_CHANGED"
  | "FOOD_DATA_OBJECT_MISSING"
  | "FOOD_DATA_INTEGRITY_FAILED"
  | "FOOD_DATA_SCHEMA_INVALID"
  | "FOOD_DATA_UNAVAILABLE";

export class FoodDataError extends Error {
  constructor(message: string, public code: FoodDataErrorCode, public status = 500) { super(message); this.name = "FoodDataError"; }
}

const SHA256 = /^[0-9a-f]{64}$/;
const OBJECT_NAME = /^[a-z0-9][a-z0-9._-]*\.json\.gz$/;
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseEntry(dataset: FoodDataset, value: unknown): FoodFileEntry {
  const fail = (what: string): never => { throw new FoodDataError(`Food Data manifest entry "${dataset}" is invalid (${what}).`, "FOOD_DATA_MANIFEST_INVALID", 502); };
  if (!isRecord(value)) return fail("not an object");
  const { object, sourceFile, columns, rows, jsonBytes, gzipBytes, jsonSha256, gzipSha256 } = value;
  if (typeof object !== "string" || !OBJECT_NAME.test(object)) fail("object name");
  if (!count(columns) || !count(rows) || !count(jsonBytes) || !count(gzipBytes)) fail("counts");
  if (typeof jsonSha256 !== "string" || !SHA256.test(jsonSha256) || typeof gzipSha256 !== "string" || !SHA256.test(gzipSha256)) fail("hashes");
  return { object: object as string, sourceFile: typeof sourceFile === "string" ? sourceFile : "", columns: columns as number, rows: rows as number, jsonBytes: jsonBytes as number, gzipBytes: gzipBytes as number, jsonSha256: jsonSha256 as string, gzipSha256: gzipSha256 as string };
}

export function parseManifest(value: unknown): FoodManifest {
  if (!isRecord(value)) throw new FoodDataError("Food Data manifest is not an object.", "FOOD_DATA_MANIFEST_INVALID", 502);
  if (value.schemaVersion !== 1) throw new FoodDataError("Unsupported Food Data manifest schema version.", "FOOD_DATA_MANIFEST_INVALID", 502);
  if (typeof value.snapshot !== "string" || !SNAPSHOT.test(value.snapshot)) throw new FoodDataError("Food Data manifest snapshot date is invalid.", "FOOD_DATA_MANIFEST_INVALID", 502);
  const files = isRecord(value.files) ? value.files : {};
  const pricing = isRecord(value.pricing) ? value.pricing : {};
  return {
    schemaVersion: 1,
    dataset: typeof value.dataset === "string" ? value.dataset : "",
    snapshot: value.snapshot,
    status: typeof value.status === "string" ? value.status : "",
    pricing: {
      source: typeof pricing.source === "string" ? pricing.source : "",
      updateFrequency: typeof pricing.updateFrequency === "string" ? pricing.updateFrequency : "",
      // Never default this: an absent price-effective date is "unknown", not today.
      priceEffectiveDate: typeof pricing.priceEffectiveDate === "string" && pricing.priceEffectiveDate ? pricing.priceEffectiveDate : null,
      interpretation: typeof pricing.interpretation === "string" ? pricing.interpretation : "",
    },
    files: { ingredients: parseEntry("ingredients", files.ingredients), recipes: parseEntry("recipes", files.recipes) },
  };
}

/** Independent per-dataset version: changes only when that dataset's bytes change. */
export function datasetVersion(manifest: FoodManifest, dataset: FoodDataset) { return `${manifest.snapshot}:${manifest.files[dataset].gzipSha256}`; }
