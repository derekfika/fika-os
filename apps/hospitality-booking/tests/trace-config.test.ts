import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Hospitality staging enables shared tracing", () => {
  const config = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("Hospitality staging declares the server-side Hub and CPU clients without exposing secrets", () => {
  const config = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_HUB_BASE_URL[\s\S]*?value:\s*https:\/\/staging-os\.fikacatering\.com/);
  assert.match(config, /variable:\s*CPU_PRODUCTION_BASE_URL[\s\S]*?value:\s*https:\/\/cpu-staging\.fikacatering\.com/);
  for (const secret of ["MNK_CANON_BRIDGE_TOKEN", "GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON", "FIKA_PDF_RENDERER_TOKEN"]) assert.match(config, new RegExp(`variable:\\s*${secret}[\\s\\S]*?secret:\\s*${secret}`));
  assert.match(config, /variable:\s*GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION[\s\S]*?value:\s*derek@fikacatering\.com/);
  assert.doesNotMatch(config, /private_key|client_secret|token:\s*[^\s]/i);
});

test("Hospitality proxy boundaries classify upstream calls without payload logging", () => {
  const source = readFileSync(new URL("../app/api/dashboard-bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /withDataTrace/);
  assert.match(source, /source:\s*"NETWORK_UPSTREAM"/);
  assert.doesNotMatch(source, /console\.(log|info).*body/);
});
