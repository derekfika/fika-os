import assert from "node:assert/strict";
import test from "node:test";
import { readGrabAndGoSource } from "../lib/grab-and-go-read";

test("CPU Grab & Go source forwarding trims the internal service token", async () => {
  const previous = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "  secret-token\n";
  let forwarded = "";
  try {
    await readGrabAndGoSource(undefined, async (_input, init) => {
      forwarded = new Headers(init?.headers).get("x-fika-internal-token") || "";
      return new Response(JSON.stringify({ orders: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(forwarded, "secret-token");
  } finally {
    if (previous === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previous;
  }
});
