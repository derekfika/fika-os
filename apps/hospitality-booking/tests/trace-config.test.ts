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
  for (const secret of ["MNK_CANON_BRIDGE_TOKEN", "FIKA_PDF_RENDERER_TOKEN"]) assert.match(config, new RegExp(`variable:\\s*${secret}[\\s\\S]*?secret:\\s*${secret}`));
  assert.doesNotMatch(config, /GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON|GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION/);
  assert.match(config, /FIKA_STAGING_DRIVE_ENABLED[\s\S]*?value: "true"/);
  assert.match(config, /FIKA_STAGING_DRIVE_AUTH_MODE[\s\S]*?value: shared-drive/);
  assert.match(config, /FIKA_STAGING_DRIVE_SHARED_DRIVE_ID[\s\S]*?value: 0ALgY_Zkd_k3cUk9PVA/);
  assert.match(config, /FIKA_STAGING_DRIVE_EMAIL[\s\S]*?value: fika-staging-drive@fika-os-dev\.iam\.gserviceaccount\.com/);
  assert.match(config, /FIKA_STAGING_DRIVE_PERMISSION_ID[\s\S]*?value: "110289228770833757986"/);
  assert.match(config, /FIKA_STAGING_DRIVE_ROOT_ID[\s\S]*?value: 1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z/);
  assert.match(config, /FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS[\s\S]*?value: "110453433265748456567,110289228770833757986"/);
  assert.match(config, /FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS[\s\S]*?value: "1uOdUgHQD7O3Op6DzgyslXG3-_aeYRm08,/);
  assert.doesNotMatch(config, /private_key|client_secret|token:\s*[^\s]/i);
});

test("Hospitality production binds the approved CPU-default matrix destination and existing DWD secret", () => {
  const config = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON[\s\S]*?secret:\s*GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON[\s\S]*?availability:\s*\[RUNTIME\]/);
  assert.match(config, /variable:\s*GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION[\s\S]*?value:\s*derek@fikacatering\.com[\s\S]*?availability:\s*\[RUNTIME\]/);
  assert.match(config, /variable:\s*GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID[\s\S]*?value:\s*1YAa7t8OEvySdxwBQBlTf2IjQBoLS-s-9[\s\S]*?availability:\s*\[RUNTIME\]/);
  assert.doesNotMatch(config, /private_key|client_secret|token:\s*[^\s]/i);
});

test("Hospitality proxy boundaries classify upstream calls without payload logging", () => {
  const source = readFileSync(new URL("../app/api/dashboard-bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /withDataTrace/);
  assert.match(source, /source:\s*"NETWORK_UPSTREAM"/);
  assert.doesNotMatch(source, /console\.(log|info).*body/);
});
