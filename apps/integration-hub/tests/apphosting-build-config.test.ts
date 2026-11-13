import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("App Hosting receives app-root standalone output while shared imports remain enabled", () => {
  // Firebase's App Hosting adapter temporarily replaces next.config.ts during
  // production builds. Keep this test source based so its typecheck does not
  // depend on the adapter-generated module's exports.
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /output:\s*["']standalone["']/);
  assert.match(config, /outputFileTracingRoot:\s*appRoot/);
  assert.match(config, /externalDir:\s*true/);
  assert.doesNotMatch(config, /turbopack\s*:/);
});

test("effective App Hosting config enables staging data-source tracing", () => {
  const config = readFileSync(new URL("../apphosting.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*FIKA_DATA_SOURCE_TRACE/);
  assert.match(config, /availability:\s*\n\s*- BUILD\s*\n\s*- RUNTIME/);
  assert.match(config, /value:\s*["']?1["']?/);
});

test("staging config uses the Logistics API base and shared internal token secret", () => {
  const config = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(config, /FIKA_STAGING_DRIVE_ENABLED[\s\S]*?value: "true"/);
  assert.match(config, /FIKA_STAGING_DRIVE_AUTH_MODE[\s\S]*?value: shared-drive/);
  assert.match(config, /FIKA_STAGING_DRIVE_SHARED_DRIVE_ID[\s\S]*?value: 0ALgY_Zkd_k3cUk9PVA/);
  assert.match(config, /FIKA_STAGING_DRIVE_EMAIL[\s\S]*?value: fika-staging-drive@fika-os-dev\.iam\.gserviceaccount\.com/);
  assert.match(config, /FIKA_STAGING_DRIVE_PERMISSION_ID[\s\S]*?value: "110289228770833757986"/);
  assert.match(config, /FIKA_STAGING_DRIVE_ROOT_ID[\s\S]*?value: 1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z/);
  assert.match(config, /FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS[\s\S]*?value: "110453433265748456567,110289228770833757986"/);
  assert.match(config, /FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS[\s\S]*?value: "1uOdUgHQD7O3Op6DzgyslXG3-_aeYRm08,/);
  assert.doesNotMatch(config, /GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON/);
  assert.match(config, /variable:\s*CPU_PRODUCTION_BASE_URL[\s\S]*?value:\s*https:\/\/cpu-staging\.fikacatering\.com/);
  assert.match(config, /variable:\s*FIKA_LOGISTICS_BASE_URL[\s\S]*?value:\s*https:\/\/logistics-staging\.fikacatering\.com/);
  assert.match(config, /variable:\s*FIKA_APP_DELIVERED_IN_URL[\s\S]*?value:\s*https:\/\/delivered-in-staging\.fikacatering\.com/);
  assert.match(config, /variable:\s*FIKA_APP_AD_HOC_URL\s*\n\s*value:\s*https:\/\/adhoc-staging\.fikacatering\.com\s*\n\s*availability:\s*\n\s*- BUILD\s*\n\s*- RUNTIME/);
  assert.match(config, /FIKA_ALLOWED_APP_ORIGINS[\s\S]*https:\/\/cpu-staging\.fikacatering\.com[\s\S]*https:\/\/logistics-staging\.fikacatering\.com[\s\S]*https:\/\/menu-planning-staging\.fikacatering\.com[\s\S]*https:\/\/hospitality-staging\.fikacatering\.com[\s\S]*https:\/\/delivered-in-staging\.fikacatering\.com[\s\S]*https:\/\/adhoc-staging\.fikacatering\.com[\s\S]*https:\/\/fika-hospitality-staging--fika-os-dev\.europe-west4\.hosted\.app[\s\S]*https:\/\/fika-cpu-production-staging--fika-os-dev\.europe-west4\.hosted\.app[\s\S]*https:\/\/fika-delivered-in-staging--fika-os-dev\.europe-west4\.hosted\.app/);
  assert.match(config, /variable:\s*FIKA_INTERNAL_API_TOKEN[\s\S]*?secret:\s*FIKA_INTERNAL_API_TOKEN@3/);
  const productionConfig = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
  assert.match(productionConfig, /variable:\s*FIKA_APP_AD_HOC_URL\s*\n\s*value:\s*https:\/\/adhoc\.fikacatering\.com\s*\n\s*availability:\s*\[BUILD, RUNTIME\]/);
  assert.match(productionConfig, /FIKA_ALLOWED_APP_ORIGINS[\s\S]*?value:[^\n]*https:\/\/adhoc\.fikacatering\.com/);
  assert.doesNotMatch(productionConfig, /https:\/\/adhoc-staging\.fikacatering\.com/);
});

test("Integration Hub Firebase config does not claim the Hospitality App Hosting backend", () => {
  const firebase = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal("apphosting" in firebase, false);
  assert.deepEqual(firebase.firestore, { rules: "firestore.rules", indexes: "firestore.indexes.json" });
});
