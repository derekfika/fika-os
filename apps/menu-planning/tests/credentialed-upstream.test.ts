import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { menuPlanningHubBaseUrl } from "../lib/hub-url";

const keys = ["FIKA_RUNTIME_MODE", "FIKA_HUB_BASE_URL", "INTEGRATION_HUB_BASE_URL"] as const;
function withEnv(values: Partial<Record<(typeof keys)[number], string>>, run: () => void) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try { run(); } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test("Menu Planning production forwards cookies only to the approved production Hub", () => {
  withEnv({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app/" }, () => {
    assert.equal(menuPlanningHubBaseUrl(), "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app");
  });
  withEnv({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com" }, () => {
    assert.throws(() => menuPlanningHubBaseUrl(), /not the approved production service/);
  });
  withEnv({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://os.fikacatering.com" }, () => {
    assert.throws(() => menuPlanningHubBaseUrl(), /resolves to a production service/);
  });
  withEnv({ FIKA_RUNTIME_MODE: "local" }, () => assert.equal(menuPlanningHubBaseUrl(), "http://localhost:3200"));
});

test("cookie- and token-bearing Menu Planning clients refuse redirects", () => {
  for (const path of ["../lib/auth.ts", "../lib/oploc-authority.ts", "../lib/production-client.ts"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /redirect: "error"/, path);
  }
});
