import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/gallagher-bookings/route";

const originalToken = process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;

test("canonical Gallagher read bridge rejects missing or incorrect server token", async () => {
  delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  const missing = await GET(new NextRequest("https://hub.example/api/gallagher-bookings"));
  assert.equal(missing.status, 503);

  process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = "expected-server-only-token";
  const wrong = await GET(new NextRequest("https://hub.example/api/gallagher-bookings", { headers: { "x-fika-gallagher-bridge-token": "wrong" } }));
  assert.equal(wrong.status, 401);
});

test.after(() => {
  if (originalToken === undefined) delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  else process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = originalToken;
});
