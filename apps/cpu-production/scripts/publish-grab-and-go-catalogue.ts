import { readFile } from "node:fs/promises";
import { publishGrabAndGoCatalogue } from "../lib/grab-and-go-catalogue-package";
import { parseGrabAndGoCatalogue } from "@fika/server-shared/grab-and-go-catalogue";

const source = process.argv[2] || process.env.GRAB_AND_GO_CATALOGUE_SOURCE;
if (!source) throw new Error("Provide a JSON source path as the first argument or set GRAB_AND_GO_CATALOGUE_SOURCE.");
const parsed = parseGrabAndGoCatalogue(JSON.parse(await readFile(source, "utf8")));
const manifest = await publishGrabAndGoCatalogue(parsed.products);
console.log(JSON.stringify({ dataset: manifest.dataset, packageVersion: manifest.packageVersion, contentHash: manifest.contentHash, recordCount: manifest.recordCount }, null, 2));
