import assert from "node:assert/strict";
import test from "node:test";
import { forwardBuffetMenu } from "../lib/buffet-menu-proxy";

test("buffet menu proxy stays closed in production and forwards only to the fixed Hub route in staging", async () => {
  const previous = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
  let requests = 0;
  const fake = async (path: string, init: RequestInit = {}) => { requests++; assert.equal(path, "/api/hospitality-buffet-selection"); assert.equal(init.method, "GET"); return Response.json({ contract: "fixture" }, { status: 200 }); };
  try {
    process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "false";
    assert.equal((await forwardBuffetMenu(fake)).status, 404); assert.equal(requests, 0);
    process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "true";
    const result = await forwardBuffetMenu(fake); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.equal(requests, 1);
    const failed = await forwardBuffetMenu(async () => { throw new Error("private diagnostics"); }); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private diagnostics/);
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED; else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = previous; }
});
