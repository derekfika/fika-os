import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cpu = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
const delivered = readFileSync(new URL("../../delivered-in/apphosting.staging.yaml", import.meta.url), "utf8");

test("CPU and Delivered-In staging configs converge on shared runtime contracts", () => {
  assert.match(cpu, /FIKA_DATA_SOURCE_TRACE[\s\S]*value: "1"/);
  assert.match(delivered, /FIKA_DATA_SOURCE_TRACE[\s\S]*value: "1"/);
  assert.match(cpu, /FIKA_APP_DELIVERED_IN_URL[\s\S]*https:\/\/fika-delivered-in-staging--fika-os-dev\.europe-west4\.hosted\.app/);
  assert.match(cpu, /FIKA_LOGISTICS_BASE_URL[\s\S]*https:\/\/logistics-staging\.fikacatering\.com/);
  assert.match(delivered, /FIKA_INTERNAL_API_TOKEN[\s\S]*secret: FIKA_INTERNAL_API_TOKEN@3/);
  assert.doesNotMatch(delivered, /DELIVERED_IN_INTERNAL_API_TOKEN/);
  assert.match(cpu, /FIKA_SNAPSHOT_BUCKET[\s\S]*fika-os-dev-staging-read-packages-europe-west4/);
  assert.match(delivered, /FIKA_SNAPSHOT_BUCKET[\s\S]*fika-os-dev-staging-read-packages-europe-west4/);
  assert.match(cpu, /GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION[\s\S]*derek@fikacatering\.com/);
  assert.match(cpu, /GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON[\s\S]*secret:\s*GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON/);
});

test("staging upstreams keep API callback URLs separate from navigation URLs", () => {
  assert.match(cpu, /FIKA_HUB_BASE_URL[\s\S]*https:\/\/staging-os\.fikacatering\.com/);
  assert.match(cpu, /MENU_PLANNING_BASE_URL[\s\S]*https:\/\/menu-planning-staging\.fikacatering\.com/);
  assert.match(cpu, /HOSPITALITY_BOOKING_BASE_URL[\s\S]*https:\/\/hospitality-staging\.fikacatering\.com/);
  assert.match(delivered, /INTEGRATION_HUB_BASE_URL[\s\S]*https:\/\/staging-os\.fikacatering\.com/);
  assert.match(delivered, /MENU_PLANNING_BASE_URL[\s\S]*https:\/\/menu-planning-staging\.fikacatering\.com/);
  assert.match(delivered, /CPU_PRODUCTION_BASE_URL[\s\S]*https:\/\/cpu-staging\.fikacatering\.com/);
});
