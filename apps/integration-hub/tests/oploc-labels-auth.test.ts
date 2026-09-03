import assert from "node:assert/strict";
import test from "node:test";
import { internalProductionRequestAllowed } from "../lib/production-internal-auth";

const request = (token?: string) => ({ headers: new Headers(token ? { "x-fika-internal-token": token } : {}) });

test("CPU OPLOC label enrichment accepts the shared internal service token", () => {
  assert.equal(internalProductionRequestAllowed(request("service-token"), { FIKA_INTERNAL_API_TOKEN: "service-token", NODE_ENV: "production" }), true);
  assert.equal(internalProductionRequestAllowed(request("wrong"), { FIKA_INTERNAL_API_TOKEN: "service-token", NODE_ENV: "production" }), false);
  assert.equal(internalProductionRequestAllowed(request(), { FIKA_INTERNAL_API_TOKEN: "service-token", NODE_ENV: "production" }), false);
});

test("missing production token does not open the Hub route in production", () => {
  assert.equal(internalProductionRequestAllowed(request(), { NODE_ENV: "production" }), false);
});
