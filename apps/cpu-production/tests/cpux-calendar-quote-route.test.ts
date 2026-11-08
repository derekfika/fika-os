import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/production-quote/route";

const request = () => new NextRequest("https://cpu.fikacatering.com/api/production-quote?bookingId=booking:1", { headers: { cookie: "session=mock" } });
const driveUrl = "https://drive.google.com/file/d/existing-file/view";

let saved: NodeJS.ProcessEnv;
test.beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, { FIKA_RUNTIME_MODE: "local", NODE_ENV: "test" });
  for (const key of ["K_SERVICE", "K_REVISION", "K_CONFIGURATION"]) delete process.env[key];
});
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

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

test("staging and unknown hosted quote requests cannot reach the Hub or redirect", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw Error("Quote fetch must be blocked"); });
  for (const mode of ["staging", "unknown", "local", undefined]) {
    Object.assign(process.env, { NODE_ENV: "production", K_SERVICE: "synthetic-hosted-cpu", FIREBASE_PROJECT_ID: "fika-os-dev" });
    if (mode === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = mode;
    const response = await GET(request());
    assert.equal(response.status, 404);
    assert.equal(response.headers.has("location"), false);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.equal((await response.json()).error.code, "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("verified production can open the saved quote with a read-only Hub GET", async t => {
  Object.assign(process.env, { NODE_ENV: "production", FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os", FIKA_HUB_BASE_URL: "https://os.fikacatering.com" });
  for (const key of ["FIREBASE_CONFIG", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) delete process.env[key];
  let quoteReads = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url) === "http://metadata.google.internal/computeMetadata/v1/project/project-id") {
      return new Response("fika-os", { headers: { "Metadata-Flavor": "Google" } });
    }
    assert.match(String(url), /^https:\/\/os\.fikacatering\.com\/api\/production\/calendar-quote\?/);
    assert.equal(init?.method, "GET");
    quoteReads++;
    return Response.json({ quote: { driveFileId: "existing-file", url: driveUrl } });
  });
  const response = await GET(request());
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), driveUrl);
  assert.equal(quoteReads, 1);
});
