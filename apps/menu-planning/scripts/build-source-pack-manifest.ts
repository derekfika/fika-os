import fs from "node:fs";
import path from "node:path";
import { buildSourcePackManifest } from "../lib/source-packs";

const [regionalRoot, weeklyRoot, output] = process.argv.slice(2);
if (!regionalRoot || !weeklyRoot || !output) throw new Error("Usage: build-source-pack-manifest <regional-root> <weekly-root> <output>");
const manifest = buildSourcePackManifest(regionalRoot, weeklyRoot, "2026-08-18T00:00:00.000Z");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${output}: ${manifest.packs.map(pack => `${pack.id} (${pack.fileCount} files)`).join(", ")}`);
