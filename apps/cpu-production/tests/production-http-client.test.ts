import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProductionFailureKind, forwardedHeaders } from "../lib/production-http-client";

test("CPU-to-Hub production reads forward the service token and request lineage", () => {
  const forwarded = forwardedHeaders({ headers: new Headers({ cookie: "fika_os_session=session", "x-fika-internal-token": "secret", "x-request-id": "request:123" }) } as never) as Record<string, string>;
  assert.equal(forwarded.cookie, "fika_os_session=session");
  assert.equal(forwarded["x-fika-internal-token"], "secret");
  assert.equal(forwarded["x-request-id"], "request:123");
});

test("CPU-to-Hub browser reads do not invent or leak a service token", () => {
  const forwarded = forwardedHeaders({ headers: new Headers({ cookie: "fika_os_session=session" }) } as never) as Record<string, string>;
  assert.equal("x-fika-internal-token" in forwarded, false);
  assert.equal(forwarded.cookie, "fika_os_session=session");
});

test("canonical Production failures retain safe hosted classifications", () => {
  assert.equal(canonicalProductionFailureKind({ status: 401 }), "authority_failure");
  assert.equal(canonicalProductionFailureKind({ status: 403 }), "authority_failure");
  assert.equal(canonicalProductionFailureKind({ status: 404 }), "not_found");
  assert.equal(canonicalProductionFailureKind({ status: 503 }), "hub_unavailable");
  assert.equal(canonicalProductionFailureKind({ code: "CPU_HUB_TIMEOUT" }), "hub_unavailable");
  assert.equal(canonicalProductionFailureKind({ code: "CPU_HUB_INVALID_JSON" }), "malformed_response");
});
