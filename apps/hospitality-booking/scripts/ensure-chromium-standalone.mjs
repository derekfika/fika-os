import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const appRoot = process.cwd();
const require = createRequire(import.meta.url);
const packageEntry = require.resolve("@sparticuz/chromium");
let packageRoot = path.dirname(packageEntry);
while (packageRoot !== path.dirname(packageRoot) && !(await stat(path.join(packageRoot, "package.json")).catch(() => null))) {
  packageRoot = path.dirname(packageRoot);
}

const sourceBin = path.join(packageRoot, "bin");
const sourceBuild = path.join(packageRoot, "build");
const targetBin = path.join(appRoot, ".next", "standalone", "node_modules", "@sparticuz", "chromium", "bin");
const targetPackage = path.dirname(targetBin);
const sourceFiles = await readdir(sourceBin);
if (!sourceFiles.length) throw new Error(`@sparticuz/chromium bin directory is empty: ${sourceBin}`);

await cp(sourceBin, targetBin, { recursive: true });
await mkdir(targetPackage, { recursive: true });
await cp(path.join(packageRoot, "package.json"), path.join(targetPackage, "package.json"));
await cp(sourceBuild, path.join(targetPackage, "build"), { recursive: true });
const targetFiles = await readdir(targetBin);
if (!targetFiles.length) throw new Error(`Standalone Chromium bin directory is empty: ${targetBin}`);
if (!(await stat(path.join(targetPackage, "build", "index.js")).catch(() => null))) throw new Error(`Standalone Chromium runtime is missing: ${targetPackage}`);

console.log(`Standalone Chromium assets (${targetFiles.length}): ${targetFiles.join(", ")}`);
