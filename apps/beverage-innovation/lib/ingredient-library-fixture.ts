import { gzipSync } from "node:zlib";
import { sha256 } from "@fika/server-shared/read-package";
import { createIngredientLibrary, ingredientLibraryColumns } from "./ingredient-library";

const columns = Object.values(ingredientLibraryColumns);
const rows = [
  ["Juniper soda", "Fixture Bottle Works", "SODA-01", "0009", "Fixture Grove", "Mixers", "Active"],
  ["Juniper soda", "Fixture Bottle Works", "SODA-01", "0009", "Fixture Grove", "Mixers", "Active"],
  ["Cloudberry cordial", "Fixture Orchard", "CORD-03", "0015", "Fixture Grove", "Syrups", "Active"],
  ["Oat drink", "Fixture Grain Co", "OAT-01", "0023", "", "Milk alternatives", "Active"],
  ["Vanilla concentrate", "Fixture Orchard", "VAN-01", "0034", "Fixture Pantry", "Syrups", "Delisted"],
];

let library: ReturnType<typeof createIngredientLibrary> | undefined;

/** The only runtime source for this slice. It has no URL, credentials, filesystem or upstream dependency. */
export function fictionalIngredientLibrary() {
  if (!library) {
    const snapshot = "2026-11-07";
    const json = Buffer.from(JSON.stringify({ schemaVersion: 1, dataset: "ingredients", snapshot, columns, rows }));
    const gzip = gzipSync(json);
    const gzipSha256 = sha256(gzip);
    const entry = {
      columns: columns.length, rows: rows.length, gzipBytes: gzip.byteLength, jsonBytes: json.byteLength,
      gzipSha256, jsonSha256: sha256(json),
    };
    library = createIngredientLibrary({ schemaVersion: 1, snapshot, files: { ingredients: entry } }, gzip, `${snapshot}:${gzipSha256}`);
  }
  return library;
}
