import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("App Hosting receives app-root standalone output", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /output:\s*["']standalone["']/);
  assert.match(config, /externalDir:\s*true/);
  assert.match(config, /turbopack:\s*\{\s*root:\s*path\.resolve\(__dirname, ["']\.\.\/\.\.["']\)/);
});
