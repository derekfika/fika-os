import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/production-quote/route";

test("stable quote link requires a user session and never accepts an internal token as user authority", async () => {
  const response = await GET(new NextRequest("https://cpu.fikacatering.com/api/production-quote?bookingId=booking:1", { headers: { "x-fika-internal-token": "service-token" } }));
  assert.equal(response.status, 401);
});

test("quote redirect forwards only the user cookie, never mutates Drive, and disables caching", async t => {
  const previous = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_HUB_BASE_URL = "http://127.0.0.1:16160";
  t.after(() => { if (previous === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = previous; });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ quote: { driveFileId: "existing-file", url: "https://drive.google.com/file/d/existing-file/view" } });
  });
  const response = await GET(new NextRequest("https://cpu.fikacatering.com/api/production-quote?bookingId=booking%3A1", { headers: { cookie: "session=mock", "x-fika-internal-token": "must-not-forward" } }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://drive.google.com/file/d/existing-file/view");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/production\/calendar-quote\?bookingId=booking%3A1$/);
  assert.equal(calls[0].init?.method, "GET");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("cookie"), "session=mock");
  assert.equal(headers.has("x-fika-internal-token"), false);
});

test("unauthorized, stale and malformed quote responses cannot redirect to arbitrary URLs", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ quote: { driveFileId: "existing-file", url: "https://untrusted.example/quote" } }));
  const request = () => new NextRequest("https://cpu.fikacatering.com/api/production-quote?bookingId=booking:1", { headers: { cookie: "session=mock" } });
  assert.equal((await GET(request())).status, 502);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Not permitted" } }, { status: 403 }));
  assert.equal((await GET(request())).status, 403);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Current PDF unavailable" } }, { status: 409 }));
  assert.equal((await GET(request())).status, 409);
});
