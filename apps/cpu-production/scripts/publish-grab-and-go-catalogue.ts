import { readFile } from "node:fs/promises";
import { publishGrabAndGoCatalogue } from "../lib/grab-and-go-catalogue-package";
import { normalizeGrabAndGoCatalogueSource } from "../lib/grab-and-go-catalogue-source";
import { parseGrabAndGoCatalogue } from "@fika/server-shared/grab-and-go-catalogue";

const validateOnly = process.argv.includes("--validate-only");
const source = process.argv.slice(2).find(argument => !argument.startsWith("--")) || process.env.GRAB_AND_GO_CATALOGUE_SOURCE;
if (!source) throw new Error("Provide a JSON source path as the first argument or set GRAB_AND_GO_CATALOGUE_SOURCE.");
const parsed = parseGrabAndGoCatalogue(normalizeGrabAndGoCatalogueSource(JSON.parse(await readFile(source, "utf8"))));
if (validateOnly) {
  console.log(JSON.stringify({ source, inputValidated: true, recordCount: parsed.products.length }, null, 2));
  process.exit(0);
}
const manifest = await publishGrabAndGoCatalogue(parsed.products);
console.log(JSON.stringify({ dataset: manifest.dataset, packageVersion: manifest.packageVersion, contentHash: manifest.contentHash, recordCount: manifest.recordCount }, null, 2));
