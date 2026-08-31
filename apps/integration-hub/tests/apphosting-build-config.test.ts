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

test("staging config uses the Logistics API base and shared internal token secret", () => {
  const config = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_LOGISTICS_BASE_URL[\s\S]*?value:\s*https:\/\/logistics-staging\.fikacatering\.com/);
  assert.match(config, /variable:\s*FIKA_INTERNAL_API_TOKEN[\s\S]*?secret:\s*FIKA_INTERNAL_API_TOKEN@3/);
});

test("Integration Hub Firebase config does not claim the Hospitality App Hosting backend", () => {
  const firebase = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal("apphosting" in firebase, false);
  assert.deepEqual(firebase.firestore, { rules: "firestore.rules", indexes: "firestore.indexes.json" });
});
