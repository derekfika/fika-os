import { gunzipSync } from "node:zlib";
import { sha256 } from "@fika/server-shared/read-package";
import { z } from "zod";

const MAX_GZIP_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_ROWS = 25_000;
export const MAX_INGREDIENT_LIBRARY_RESULTS = 50;

export const ingredientLibraryColumns = {
  name: "Product Name",
  supplier: "Supplier Name",
  productCode: "Product Code",
  supplierCode: "Supplier Code",
  brand: "Brand",
  category: "Category (365 Kitchen Management)",
  purchaseStatus: "Purchase Status",
} as const;
const fields = Object.keys(ingredientLibraryColumns) as (keyof typeof ingredientLibraryColumns)[];
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  snapshot: z.iso.date(),
  files: z.object({
    ingredients: z.object({
      columns: z.number().int().min(fields.length).max(160),
      rows: z.number().int().min(0).max(MAX_ROWS),
      gzipBytes: z.number().int().min(1).max(MAX_GZIP_BYTES),
      jsonBytes: z.number().int().min(1).max(MAX_JSON_BYTES),
      gzipSha256: z.string().regex(/^[a-f0-9]{64}$/),
      jsonSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
});
const collator = new Intl.Collator("en-GB", { sensitivity: "base" });

type Product = Readonly<Record<keyof typeof ingredientLibraryColumns, string> & { sourceRowIndex: number }>;

function invalidSnapshot(): never {
  throw Object.assign(new Error("The ingredient library snapshot could not be verified."), { status: 503, code: "BEVERAGE_INGREDIENT_SNAPSHOT_INVALID" });
}

/** Consume the ingredients part of Hub Food Data v1. The caller supplies the exact pinned version separately. */
export function createIngredientLibrary(manifest: unknown, gzip: Uint8Array, pinnedVersion: string) {
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) invalidSnapshot();
  const { snapshot, files: { ingredients: entry } } = result.data;
  const version = `${snapshot}:${entry.gzipSha256}`;
  if (version !== pinnedVersion) {
    throw Object.assign(new Error("The ingredient snapshot differs from the pinned version."), { status: 409, code: "BEVERAGE_INGREDIENT_VERSION_CHANGED" });
  }
  if (gzip.byteLength !== entry.gzipBytes || sha256(gzip) !== entry.gzipSha256) invalidSnapshot();

  let decoded: unknown;
  try {
    const json = gunzipSync(gzip, { maxOutputLength: entry.jsonBytes });
    if (json.byteLength !== entry.jsonBytes || sha256(json) !== entry.jsonSha256) invalidSnapshot();
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch { invalidSnapshot(); }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) invalidSnapshot();
  const { schemaVersion, dataset, snapshot: bundleSnapshot, columns, rows } = decoded as Record<string, unknown>;
  if (schemaVersion !== 1 || dataset !== "ingredients" || bundleSnapshot !== snapshot) invalidSnapshot();
  if (!Array.isArray(columns) || columns.length !== entry.columns || !columns.every(column => typeof column === "string")) invalidSnapshot();
  if (!Array.isArray(rows) || rows.length !== entry.rows) invalidSnapshot();
  const positions = fields.map(field => {
    const label = ingredientLibraryColumns[field];
    const position = columns.indexOf(label);
    if (position === -1 || position !== columns.lastIndexOf(label)) invalidSnapshot();
    return position;
  });

  const products: Product[] = [];
  rows.forEach((row, sourceRowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length || !row.every(cell => typeof cell === "string")) invalidSnapshot();
    const values = positions.map(position => row[position].trim());
    if (values.some(value => value.length > 240)) invalidSnapshot();
    const product = Object.fromEntries(fields.map((field, index) => [field, values[index]])) as Record<keyof typeof ingredientLibraryColumns, string>;
    if (product.name) products.push(Object.freeze({ sourceRowIndex, ...product }));
  });
  products.sort((left, right) => collator.compare(left.name, right.name) || left.sourceRowIndex - right.sourceRowIndex);
  const indexed = products.map(product => ({
    product,
    text: fields.map(field => product[field]).join(" ").toLocaleLowerCase("en-GB"),
  }));

  return {
    source: Object.freeze({ dataset: "ingredients" as const, snapshot, version }),
    search(query: string, limit: number) {
      const tokens = query.toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
      const matches = indexed.filter(entry => tokens.every(token => entry.text.includes(token)));
      return { products: matches.slice(0, Math.max(0, Math.min(limit, MAX_INGREDIENT_LIBRARY_RESULTS))).map(entry => entry.product), matchCount: matches.length };
    },
  };
}
