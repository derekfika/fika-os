import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import nextConfig from "../next.config";

test("App Hosting receives app-root standalone output while shared imports remain enabled", () => {
  assert.equal(nextConfig.output, "standalone");
  assert.equal(nextConfig.outputFileTracingRoot, path.resolve(process.cwd()));
  assert.equal(nextConfig.experimental?.externalDir, true);
  assert.equal(nextConfig.turbopack, undefined);
});

test("effective App Hosting config enables staging data-source tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*\n\s*- BUILD\s*\n\s*- RUNTIME/);
  assert.match(config, /value:\s*["']?1["']?/);
});
