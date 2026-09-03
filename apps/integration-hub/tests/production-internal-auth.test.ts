import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { internalProductionRequestAllowed } from "../lib/production-internal-auth";

const request = (token?: string) => ({ headers: new Headers(token ? { "x-fika-internal-token": token } : {}) });

test("Hub production internal reads require the configured token outside local development", () => {
  assert.equal(internalProductionRequestAllowed(request(), { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIKA_INTERNAL_API_TOKEN: "secret" }), false);
  assert.equal(internalProductionRequestAllowed(request("wrong"), { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIKA_INTERNAL_API_TOKEN: "secret" }), false);
  assert.equal(internalProductionRequestAllowed(request("secret"), { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIKA_INTERNAL_API_TOKEN: "secret" }), true);
});

test("Hub production internal reads retain the explicit local no-token fallback", () => {
  assert.equal(internalProductionRequestAllowed(request(), { NODE_ENV: "development", FIKA_RUNTIME_MODE: "local" }), true);
  assert.equal(internalProductionRequestAllowed(request(), { NODE_ENV: "test", FIKA_RUNTIME_MODE: "staging" }), false);
});

test("Hub production GET keeps browser authentication on the non-internal path", () => {
  const route = readFileSync(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  assert.match(route, /internalProductionRequestAllowed\(request\)/);
  assert.match(route, /: await requireActor\(request\)/);
  assert.match(route, /assertPermission\(actor, "canonical\.view"\)/);
});
