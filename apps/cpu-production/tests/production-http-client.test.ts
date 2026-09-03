import assert from "node:assert/strict";
import test from "node:test";
import { forwardedHeaders } from "../lib/production-http-client";

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
