import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { importBrianRecipes } from "../lib/recipe-importer";

const root = process.argv[2] || path.resolve(process.cwd(), "../../tmp/menu-source-20260818-a/regional/REGIONAL MENUS 2026");
async function findDocx(directory: string): Promise<string[]> { const entries = await readdir(directory, { withFileTypes: true }); const found: string[] = []; for (const entry of entries) { const full = path.join(directory, entry.name); if (entry.isDirectory()) found.push(...await findDocx(full)); else if (entry.name.toLowerCase().endsWith(".docx")) found.push(full); } return found; }
const files = (await findDocx(root)).sort();
const result = await importBrianRecipes(files);
await mkdir(path.resolve(process.cwd(), "fixtures"), { recursive: true });
await writeFile(path.resolve(process.cwd(), "fixtures/brian-recipe-candidates.json"), JSON.stringify({ sourceRoot: root, generatedAt: new Date().toISOString(), sourceCount: files.length, candidateCount: result.candidates.length, warnings: result.warnings, candidates: result.candidates }, null, 2));
console.log(`Wrote ${result.candidates.length} Brian recipe candidates from ${files.length} DOCX files.`);
