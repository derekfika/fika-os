import { FoodDataError, type FoodDataset, type FoodFileEntry } from "./manifest";

/** Positional export: `rows[n][i]` belongs to `columns[i]`. Cells are the original source strings. */
export type FoodBundle = { schemaVersion: 1; dataset: FoodDataset; snapshot: string; columns: string[]; rows: string[][] };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Streaming gunzip with a hard output cap so a corrupt or hostile payload cannot exhaust memory. */
export async function gunzipBounded(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new FoodDataError("Food Data payload expands beyond its declared size.", "FOOD_DATA_INTEGRITY_FAILED", 502); }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function integrity(message: string): never { throw new FoodDataError(message, "FOOD_DATA_INTEGRITY_FAILED", 502); }
function schema(message: string): never { throw new FoodDataError(message, "FOOD_DATA_SCHEMA_INVALID", 502); }

/**
 * Verifies the gzip bytes against the manifest (transport-level SHA-256), decompresses, verifies the
 * decompressed JSON SHA-256, then validates the positional schema. The gzip payload is served without a
 * `Content-Encoding` header precisely so the browser hands us the exact stored bytes to hash.
 */
export async function decodeBundle(dataset: FoodDataset, gzip: Uint8Array, entry: FoodFileEntry, snapshot: string): Promise<FoodBundle> {
  if (gzip.byteLength !== entry.gzipBytes) integrity(`The ${dataset} download is ${gzip.byteLength} bytes; the manifest declares ${entry.gzipBytes}.`);
  if (await sha256Hex(gzip) !== entry.gzipSha256) integrity(`The ${dataset} download failed its SHA-256 check.`);
  const json = await gunzipBounded(gzip, entry.jsonBytes);
  if (json.byteLength !== entry.jsonBytes) integrity(`The decompressed ${dataset} payload is ${json.byteLength} bytes; the manifest declares ${entry.jsonBytes}.`);
  if (await sha256Hex(json) !== entry.jsonSha256) integrity(`The decompressed ${dataset} payload failed its SHA-256 check.`);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)); } catch { return schema(`The ${dataset} payload is not valid JSON.`); }
  return validateBundle(dataset, parsed, entry, snapshot);
}

export function validateBundle(dataset: FoodDataset, value: unknown, entry: FoodFileEntry, snapshot: string): FoodBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return schema(`The ${dataset} payload is not an object.`);
  const bundle = value as Record<string, unknown>;
  if (bundle.schemaVersion !== 1) schema(`The ${dataset} payload has an unsupported schema version.`);
  if (bundle.dataset !== dataset) schema(`The payload dataset is "${String(bundle.dataset)}", expected "${dataset}".`);
  if (bundle.snapshot !== snapshot) schema(`The ${dataset} payload snapshot does not match the manifest.`);
  const columns = bundle.columns;
  if (!Array.isArray(columns) || columns.length !== entry.columns || !columns.every(column => typeof column === "string")) return schema(`The ${dataset} columns do not match the manifest (${entry.columns} expected).`);
  const rows = bundle.rows;
  if (!Array.isArray(rows) || rows.length !== entry.rows) return schema(`The ${dataset} payload has ${Array.isArray(rows) ? rows.length : "no"} rows; the manifest declares ${entry.rows}.`);
  const width = columns.length;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== width) schema(`Row ${index + 1} of ${dataset} is not positional against its columns.`);
    for (const cell of row as unknown[]) if (typeof cell !== "string") schema(`Row ${index + 1} of ${dataset} contains a non-text cell.`);
  }
  return { schemaVersion: 1, dataset, snapshot, columns: columns as string[], rows: rows as string[][] };
}

/** Resolves column names to positions once; missing required columns fail loudly instead of reading the wrong cell. */
export function columnIndex(columns: readonly string[], required: readonly string[], label: string) {
  const positions = new Map<string, number>();
  columns.forEach((name, position) => { if (!positions.has(name)) positions.set(name, position); });
  const missing = required.filter(name => !positions.has(name));
  if (missing.length) schema(`The ${label} export is missing required column(s): ${missing.join(", ")}.`);
  return positions;
}
