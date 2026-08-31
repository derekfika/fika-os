import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Hospitality staging enables shared tracing", () => {
  const config = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("Hospitality proxy boundaries classify upstream calls without payload logging", () => {
  const source = readFileSync(new URL("../app/api/dashboard-bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /withDataTrace/);
  assert.match(source, /source:\s*"NETWORK_UPSTREAM"/);
  assert.doesNotMatch(source, /console\.(log|info).*body/);
});
