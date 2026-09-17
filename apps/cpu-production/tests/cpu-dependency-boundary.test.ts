import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cpuRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedRoot = path.resolve(cpuRoot, "..", "..", "packages", "server-shared");
const siblingApps = new Set(["menu-planning", "integration-hub", "delivered-in", "hospitality-booking", "logistics"]);
const importSpecifier = /\b(?:from|import)\s*(?:type\s*)?(?:\(\s*)?["']([^"']+)["']/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", ".next"].includes(entry.name)) result.push(...await sourceFiles(fullPath));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

test("CPU source graph does not import sibling app private source", async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(cpuRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importSpecifier)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = path.normalize(path.resolve(path.dirname(file), specifier));
      const segments = resolved.split(path.sep);
      const appsIndex = segments.lastIndexOf("apps");
      if (appsIndex >= 0 && siblingApps.has(segments[appsIndex + 1])) violations.push(`${path.relative(cpuRoot, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("CPU shared server imports are declared and resolvable from the package manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(sharedRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string>; exports?: Record<string, string> };
  assert.equal(manifest.dependencies?.zod, "^4.1.12");
  const meterTarget = manifest.exports?.["./data-source-meter-server"];
  assert.equal(meterTarget, "./src/data-source-meter-server.ts");
  assert.ok(existsSync(path.join(sharedRoot, meterTarget!.replace(/^\.\//, ""))));
  for (const file of await sourceFiles(cpuRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/@fika\/server-shared\/([A-Za-z0-9-]+)/g)) {
      assert.ok(manifest.exports?.[`./${match[1]}`], `Missing server-shared export for ${match[1]}`);
    }
  }
});
