// Builds the versioned, compressed en_GB dictionary package used by the Menu Planning spellchecker.
//   node scripts/build-en-gb-dictionary.mjs
// Source: the pinned devDependency `dictionary-en-gb` (SCOWL word lists, Hunspell .aff/.dic). Output is deterministic for a given
// source version, so the package can be re-checked by anyone: the sha256 in the metadata must match the gzip bytes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const source = JSON.parse(readFileSync(join(appRoot, "node_modules/dictionary-en-gb/package.json"), "utf8"));
const aff = readFileSync(join(appRoot, "node_modules/dictionary-en-gb/index.aff"), "utf8");
const dic = readFileSync(join(appRoot, "node_modules/dictionary-en-gb/index.dic"), "utf8");
const licence = readFileSync(join(appRoot, "node_modules/dictionary-en-gb/license"), "utf8");
const culinary = readFileSync(join(appRoot, "lib/dictionary/culinary-words.txt"), "utf8")
  .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

const version = `en-GB-${source.version}-culinary-1`;
const payloadJson = JSON.stringify({
  format: "fika.en-gb-hunspell.v1",
  version,
  files: { aff, dic, culinary: culinary.join("\n") },
  licence,
});
const gz = gzipSync(Buffer.from(payloadJson, "utf8"), { level: 9 });
const sha256 = createHash("sha256").update(gz).digest("hex");

const outDir = join(appRoot, "dictionary");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${version}.json.gz`), gz);
writeFileSync(join(outDir, `${version}.meta.json`), `${JSON.stringify({
  version,
  format: "fika.en-gb-hunspell.v1",
  encoding: "gzip",
  sha256,
  byteLength: gz.length,
  uncompressedByteLength: Buffer.byteLength(payloadJson, "utf8"),
  culinaryWordCount: culinary.length,
  source: {
    package: source.name,
    version: source.version,
    licence: source.license,
    origin: "SCOWL (Spell Checker Oriented Word Lists) via wordlist.aspell.net, packaged by wooorm/dictionaries",
    licenceFile: "licence text is embedded in the payload and must ship with it",
  },
  updateProcess: "Bump dictionary-en-gb in apps/menu-planning/package.json, re-run this script, then review sha256 and size before upload.",
}, null, 2)}\n`);

console.log(JSON.stringify({ version, gzipBytes: gz.length, sha256, uncompressedBytes: Buffer.byteLength(payloadJson, "utf8"), culinaryWords: culinary.length }, null, 2));
