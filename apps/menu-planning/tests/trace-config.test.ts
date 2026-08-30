import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Menu Planning effective App Hosting config enables tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*(?:\[BUILD, RUNTIME\]|\n\s*- BUILD\s*\n\s*- RUNTIME)/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("Menu Planning publication route has a server trace boundary", () => {
  const source = readFileSync(new URL("../app/api/rolling-menu/publications/route.ts", import.meta.url), "utf8");
  assert.match(source, /withDataTrace/);
  assert.match(source, /menu-planning\.publications\.load/);
});
