import assert from "node:assert/strict";
import test from "node:test";
import { checkerLink, dishSafetyStatus } from "../components/studio-dish-safety-model";
import { localStudioCheckerOrigin, localStudioSafetyAvailable } from "../lib/runtime";

const local = { NODE_ENV: "test" as const, FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8896" };
const subject = { dishId: "dish-1", revision: 3, sourceHash: "a".repeat(64) };

test("review links bind an exact saved subject to a loopback or the pinned staging CPU origin", () => {
  assert.equal(checkerLink("http://127.0.0.1:3400", subject, "dish-1", 3), "http://127.0.0.1:3400/allergens/studio/dish-1/3");
  assert.equal(checkerLink("https://cpu-staging.fikacatering.com", subject, "dish-1", 3), "https://cpu-staging.fikacatering.com/allergens/studio/dish-1/3");
  for (const origin of [undefined, "https://example.com", "https://cpu.fikacatering.com", "http://localhost:3400/path", "http://127.0.0.1:99999"]) {
    assert.equal(checkerLink(origin, subject, "dish-1", 3), undefined);
  }
  assert.equal(checkerLink("http://localhost:3400", subject, "dish-1", 4), undefined);
  assert.equal(checkerLink("http://localhost:3400", { ...subject, sourceHash: "invalid" }, "dish-1", 3), undefined);
});
test("safety capability remains closed outside the explicit local emulator", () => {
  assert.equal(localStudioSafetyAvailable(local), true);
  assert.equal(localStudioCheckerOrigin({ ...local, FIKA_STUDIO_CPU_BASE_URL: "http://localhost:3400" }), "http://localhost:3400");
  assert.equal(localStudioCheckerOrigin({ ...local, FIKA_STUDIO_CPU_BASE_URL: "https://cpu-staging.fikacatering.com" }), undefined);
  assert.equal(localStudioSafetyAvailable({ ...local, FIRESTORE_EMULATOR_HOST: "" }), false);
  assert.equal(localStudioCheckerOrigin({ ...local, FIKA_STUDIO_LOCAL_PREVIEW: "1", NODE_ENV: "development", FIKA_STUDIO_CPU_BASE_URL: "http://localhost:3400" }), undefined);
});

test("unknown review responses remain unavailable", () => {
  for (const state of ["unverified", "in_review", "verified", "revoked", "unavailable"] as const) {
    assert.equal(dishSafetyStatus(state), state);
  }
  assert.equal(dishSafetyStatus("approved"), "unavailable");
  assert.equal(dishSafetyStatus(undefined), "unavailable");
});
