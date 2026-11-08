import test from "node:test";
import assert from "node:assert/strict";
import { beverageFirestoreHost, requireLocalBeverageActor } from "../lib/runtime";

const keys = [
  "NODE_ENV", "FIKA_RUNTIME_MODE", "FIREBASE_PROJECT_ID", "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST", "FIKA_LOCAL_GOOGLE_AUTH", "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "FIKA_BEVERAGE_LOCAL_AUTH", "FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS", "FIKA_BEVERAGE_LOCAL_OPLOC_IDS",
  "FIKA_BEVERAGE_LOCAL_ACTOR_ID",
] as const;
const env: Record<string, string | undefined> = process.env;
const saved = Object.fromEntries(keys.map(key => [key, env[key]]));
function configure(mode = "local") {
  for (const key of keys) delete env[key];
  env.NODE_ENV = "test";
  process.env.FIKA_RUNTIME_MODE = mode; process.env.FIREBASE_PROJECT_ID = "demo-fika-os";
  process.env.FIKA_BEVERAGE_LOCAL_AUTH = "fixture";
}
test.afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

test("Beverage storage requires explicit local fixture mode and rejects cloud Auth, production builds and non-loopback stores", () => {
  configure();
  delete process.env.FIKA_RUNTIME_MODE;
  assert.throws(() => beverageFirestoreHost(), { code: "BEVERAGE_LOCAL_RUNTIME_REQUIRED" });
  configure();
  delete process.env.FIKA_BEVERAGE_LOCAL_AUTH;
  assert.throws(() => beverageFirestoreHost(), { code: "BEVERAGE_LOCAL_AUTH_DISABLED" });
  configure();
  env.NODE_ENV = "production";
  assert.throws(() => beverageFirestoreHost(), { code: "BEVERAGE_PRODUCTION_RUNTIME_DISABLED" });
  configure();
  process.env.FIKA_LOCAL_GOOGLE_AUTH = "true";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "fixture-cloud-project";
  assert.throws(() => beverageFirestoreHost(), { code: "BEVERAGE_LOCAL_AUTH_EMULATOR_REQUIRED" });
  configure();
  process.env.FIRESTORE_EMULATOR_HOST = "example.test:8294";
  assert.throws(() => beverageFirestoreHost(), /loopback Firestore emulator/);
});

test("blank or invalid action and site fixture settings never expand permission", () => {
  configure();
  const request = new Request("http://localhost:13617/api/specials");
  assert.throws(() => requireLocalBeverageActor(request, "View"), { code: "AUTHMOD_DENIED" });
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "";
  assert.throws(() => requireLocalBeverageActor(request, "View"), { code: "AUTHMOD_DENIED" });
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View,Publish";
  assert.throws(() => requireLocalBeverageActor(request, "View"), { code: "BEVERAGE_LOCAL_ACTIONS_INVALID" });
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  assert.deepEqual(requireLocalBeverageActor(request, "View").scopeOplocIds, []);
  process.env.FIKA_BEVERAGE_LOCAL_OPLOC_IDS = "";
  assert.deepEqual(requireLocalBeverageActor(request, "View").scopeOplocIds, []);
  assert.throws(() => requireLocalBeverageActor(request, "View", "fixture-oploc:london"), { code: "AUTHMOD_OPLOC_DENIED" });
  process.env.FIKA_BEVERAGE_LOCAL_OPLOC_IDS = "oploc:example-real-id";
  assert.throws(() => requireLocalBeverageActor(request, "View"), { code: "BEVERAGE_LOCAL_SCOPE_INVALID" });
});

test("Beverage defaults to its own emulator port", () => { configure(); assert.equal(beverageFirestoreHost(), "127.0.0.1:8294"); });
test("Beverage rejects non-local runtimes, hosts and ungranted fixture actions", () => {
  configure("staging"); assert.throws(() => beverageFirestoreHost(), /emulator configuration is forbidden|local development mode/i);
  configure(); assert.throws(() => requireLocalBeverageActor(new Request("https://example.test/api/beverages"), "View"), /local browser only/i);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  assert.throws(() => requireLocalBeverageActor(new Request("http://localhost:13617/api/beverages"), "Approve"), /does not grant/i);
});
