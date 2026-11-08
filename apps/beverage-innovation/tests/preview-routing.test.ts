import test from "node:test";
import assert from "node:assert/strict";
import { beveragePreviewRouteDecision } from "../lib/preview-routing";

const staging = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev" };
const local = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os", FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "fixture" };
const oplocs = "/api/preview/oplocs";
const host = "beverage-staging.fikacatering.com";

test("staging preview routes to mock, hides all data APIs, and exposes only build identity", () => {
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", staging), "mock");
  assert.equal(beveragePreviewRouteDecision("/specials", "beverage-staging.fikacatering.com", staging), "mock");
  assert.equal(beveragePreviewRouteDecision("/api/beverages", "beverage-staging.fikacatering.com", staging), "hide-api");
  assert.equal(beveragePreviewRouteDecision("/api/imports/commit", "beverage-staging.fikacatering.com", staging), "hide-api");
  assert.equal(beveragePreviewRouteDecision("/api/build-info", "beverage-staging.fikacatering.com", staging), "build-info");
});

test("the explicit staging gate opens only the canonical OPLOC GET", () => {
  const enabled = {
    ...staging, FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com",
    FIKA_BEVERAGE_HUB_OPLOC_READS: "1", FIKA_BEVERAGE_HUB_OPLOC_IDS: "oploc:fixture-a",
    FIREBASE_AUTH_EMULATOR_HOST: undefined, FIRESTORE_EMULATOR_HOST: undefined,
    GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined,
  };
  assert.equal(beveragePreviewRouteDecision(oplocs, host, { ...enabled, FIKA_BEVERAGE_HUB_OPLOC_READS: undefined }), "hide-api");
  assert.equal(beveragePreviewRouteDecision(oplocs, host, enabled), "oploc-read");
  for (const method of ["POST", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    assert.equal(beveragePreviewRouteDecision(oplocs, host, enabled, method), "hide-api");
  }
  for (const path of ["/api/beverages", "/api/imports/commit", "/api/ingredient-library", "/api/preview/oplocs/other"]) {
    assert.equal(beveragePreviewRouteDecision(path, host, enabled), "hide-api");
  }
  assert.equal(beveragePreviewRouteDecision(oplocs, "fika-beverage-staging.hosted.app", enabled), "hide-api");
  assert.equal(beveragePreviewRouteDecision(oplocs, host, { ...enabled, FIKA_HUB_BASE_URL: "https://os.fikacatering.com" }), "hide-api");
  assert.equal(beveragePreviewRouteDecision(oplocs, host, { ...enabled, FIKA_BEVERAGE_HUB_OPLOC_IDS: "oploc:fixture-a,oploc:fixture-a" }), "hide-api");
  assert.equal(beveragePreviewRouteDecision(oplocs, host, { ...enabled, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8294" }), "hide-api");
});

test("preview mode fails closed outside the dedicated staging project or explicit loopback fixture", () => {
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", { ...staging, FIREBASE_PROJECT_ID: "fika-os" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", { ...staging, FIKA_RUNTIME_MODE: "production" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "localhost", { ...local, FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "example.com", local), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/api/beverages", "localhost", { ...local, FIKA_BEVERAGE_PREVIEW_ONLY: "0" }), "pass-through");
});
