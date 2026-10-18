import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getHubBaseUrl } from "../lib/hub-url";

const prod = "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app";

test("CPU production forwards credentials only to the approved production Hub", () => {
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: `${prod}/` }), prod);
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "production", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com" }), /not the approved production service/);
});

test("CPU staging cannot be pointed at the production Hub, and local development is unchanged", () => {
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com/" }), "https://staging-os.fikacatering.com");
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: prod }), /resolves to a production service/);
  assert.equal(getHubBaseUrl({ FIKA_RUNTIME_MODE: "local" }), "http://localhost:3200");
});

test("cookie- and token-bearing CPU clients refuse redirects", () => {
  for (const path of ["../lib/production-http-client.ts", "../lib/menu-planning-http-client.ts"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /redirect: "error"/, path);
  }
});
