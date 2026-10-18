import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function yamlValue(path: string, variable: string) {
  const lines = read(path).split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `- variable: ${variable}`);
  return index >= 0 ? /value:\s*(\S+)/.exec(lines[index + 1])?.[1] : undefined;
}

const CPU = "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app";
const LOGISTICS = "https://fika-os-prod-logistics--fika-os.europe-west4.hosted.app";

test("the production Hub names the variables its CPU and Logistics notification clients actually read", () => {
  const source = read("../lib/cpu-projection-client.ts") + read("../lib/logistics-projection-client.ts");
  assert.match(source, /process\.env\.CPU_PRODUCTION_BASE_URL/);
  assert.match(source, /process\.env\.FIKA_LOGISTICS_BASE_URL/);
  assert.equal(yamlValue("../apphosting.production.yaml", "CPU_PRODUCTION_BASE_URL"), CPU);
  assert.equal(yamlValue("../apphosting.production.yaml", "FIKA_LOGISTICS_BASE_URL"), LOGISTICS);
});

test("the production Hub destinations match the verified backends and pass the credentialed-upstream guard", () => {
  assert.equal(approvedCredentialedUpstream("cpu", yamlValue("../apphosting.production.yaml", "CPU_PRODUCTION_BASE_URL")!, "production"), CPU);
  assert.equal(approvedCredentialedUpstream("logistics", yamlValue("../apphosting.production.yaml", "FIKA_LOGISTICS_BASE_URL")!, "production"), LOGISTICS);
  // The same destinations in the CPU/Hospitality/Logistics production files are the verified source of these values.
  assert.equal(yamlValue("../../hospitality-booking/apphosting.production.yaml", "CPU_PRODUCTION_BASE_URL"), CPU);
  assert.equal(yamlValue("../../cpu-production/apphosting.production.yaml", "FIKA_LOGISTICS_BASE_URL"), LOGISTICS);
});

test("staging Hub keeps its own staging destinations and none are production", () => {
  assert.equal(yamlValue("../apphosting.staging.yaml", "CPU_PRODUCTION_BASE_URL"), "https://cpu-staging.fikacatering.com");
  assert.equal(yamlValue("../apphosting.staging.yaml", "FIKA_LOGISTICS_BASE_URL"), "https://logistics-staging.fikacatering.com");
});

test("production Hospitality supplies the browser Hub sign-in URL, matching the other production apps", () => {
  assert.equal(yamlValue("../../hospitality-booking/apphosting.production.yaml", "NEXT_PUBLIC_FIKA_HUB_URL"), "https://os.fikacatering.com");
  assert.equal(yamlValue("../../menu-planning/apphosting.production.yaml", "NEXT_PUBLIC_FIKA_HUB_URL"), "https://os.fikacatering.com");
  assert.equal(yamlValue("../../hospitality-booking/apphosting.staging.yaml", "NEXT_PUBLIC_FIKA_HUB_URL"), "https://staging-os.fikacatering.com");
});

test("the Angel Court inbox-scan proxy never falls back to loopback in hosted runtimes", () => {
  const route = read("../../hospitality-booking/app/api/angel-court/inbox/scan/route.ts");
  assert.match(route, /hostedRuntime\(\) \? undefined : "http:\/\/127\.0\.0\.1:3200"/);
  assert.match(route, /status: 503/);
  // The Hub side of this operation is local-development only, so no hosted INTEGRATION_HUB_URL is configured on purpose.
  assert.match(read("../app/api/angel-court/inbox/scan/route.ts"), /assertLocalSafety\(\)/);
  assert.equal(yamlValue("../../hospitality-booking/apphosting.production.yaml", "INTEGRATION_HUB_URL"), undefined);
});
