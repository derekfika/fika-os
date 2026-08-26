import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import nextConfig from "../next.config";

test("App Hosting receives app-root standalone output while shared imports remain enabled", () => {
  assert.equal(nextConfig.output, "standalone");
  assert.equal(nextConfig.outputFileTracingRoot, path.resolve(process.cwd()));
  assert.equal(nextConfig.experimental?.externalDir, true);
  assert.equal(nextConfig.turbopack, undefined);
});
