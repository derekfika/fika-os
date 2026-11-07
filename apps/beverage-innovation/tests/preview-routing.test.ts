import test from "node:test";
import assert from "node:assert/strict";
import { beveragePreviewRouteDecision } from "../lib/preview-routing";

const staging = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev" };
const local = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os", FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "fixture" };

test("staging preview routes to mock, hides all data APIs, and exposes only build identity", () => {
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", staging), "mock");
  assert.equal(beveragePreviewRouteDecision("/specials", "beverage-staging.fikacatering.com", staging), "mock");
  assert.equal(beveragePreviewRouteDecision("/api/beverages", "beverage-staging.fikacatering.com", staging), "hide-api");
  assert.equal(beveragePreviewRouteDecision("/api/imports/commit", "beverage-staging.fikacatering.com", staging), "hide-api");
  assert.equal(beveragePreviewRouteDecision("/api/build-info", "beverage-staging.fikacatering.com", staging), "build-info");
});

test("preview mode fails closed outside the dedicated staging project or explicit loopback fixture", () => {
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", { ...staging, FIREBASE_PROJECT_ID: "fika-os" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "beverage-staging.fikacatering.com", { ...staging, FIKA_RUNTIME_MODE: "production" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "localhost", { ...local, FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "" }), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/", "example.com", local), "unavailable");
  assert.equal(beveragePreviewRouteDecision("/api/beverages", "localhost", { ...local, FIKA_BEVERAGE_PREVIEW_ONLY: "0" }), "pass-through");
});
