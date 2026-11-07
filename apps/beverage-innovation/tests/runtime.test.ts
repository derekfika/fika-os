import test from "node:test";
import assert from "node:assert/strict";
import { beverageFirestoreHost, requireLocalBeverageActor } from "../lib/runtime";

const saved = { mode: process.env.FIKA_RUNTIME_MODE, project: process.env.FIREBASE_PROJECT_ID, firestore: process.env.FIRESTORE_EMULATOR_HOST, auth: process.env.FIKA_BEVERAGE_LOCAL_AUTH, actions: process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS };
function configure(mode = "local") {
  process.env.FIKA_RUNTIME_MODE = mode; process.env.FIREBASE_PROJECT_ID = "demo-fika-os";
  delete process.env.FIRESTORE_EMULATOR_HOST; process.env.FIKA_BEVERAGE_LOCAL_AUTH = "fixture";
  delete process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS;
}
test.after(() => {
  if (saved.mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = saved.mode;
  if (saved.project === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = saved.project;
  if (saved.firestore === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = saved.firestore;
  if (saved.auth === undefined) delete process.env.FIKA_BEVERAGE_LOCAL_AUTH; else process.env.FIKA_BEVERAGE_LOCAL_AUTH = saved.auth;
  if (saved.actions === undefined) delete process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS; else process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = saved.actions;
});

test("Beverage defaults to its own emulator port", () => { configure(); assert.equal(beverageFirestoreHost(), "127.0.0.1:8294"); });
test("Beverage rejects non-local runtimes, hosts and ungranted fixture actions", () => {
  configure("staging"); assert.throws(() => beverageFirestoreHost(), /emulator configuration is forbidden|local development mode/i);
  configure(); assert.throws(() => requireLocalBeverageActor(new Request("https://example.test/api/beverages"), "View"), /local browser only/i);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  assert.throws(() => requireLocalBeverageActor(new Request("http://localhost:13617/api/beverages"), "Approve"), /does not grant/i);
});
