import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localActorAllowed } from "../lib/actor";

test("the synthetic local actor is only possible in a local, non-production, non-hosted runtime", () => {
  assert.equal(localActorAllowed({ NODE_ENV: "development" }), true);
  assert.equal(localActorAllowed({ NODE_ENV: "development", FIKA_RUNTIME_MODE: "local" }), true);
  assert.equal(localActorAllowed({ NODE_ENV: "production" }), false);
  assert.equal(localActorAllowed({ NODE_ENV: "production", FIKA_RUNTIME_MODE: "local" }), false);
  assert.equal(localActorAllowed({ NODE_ENV: "development", FIKA_RUNTIME_MODE: "staging" }), false, "staging config disables it even if NODE_ENV is wrong");
  assert.equal(localActorAllowed({ NODE_ENV: "development", FIKA_RUNTIME_MODE: "production" }), false);
  assert.equal(localActorAllowed({ NODE_ENV: "development", K_SERVICE: "fika-ad-hoc" }), false, "hosted Cloud Run / App Hosting runtime");
  assert.equal(localActorAllowed({ NODE_ENV: "test", FIREBASE_CONFIG: "{}" }), false);
});

test("the staging App Hosting config declares a non-local runtime mode", () => {
  const yaml = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
  assert.match(yaml, /FIKA_RUNTIME_MODE\s*\r?\n\s*value:\s*staging/);
});
