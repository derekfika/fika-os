import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { DELETE, POST } from "../app/angel-court/gallagher/session/route";
import { GET as getData } from "../app/angel-court/gallagher/data/route";
import { gallagherDataResponse } from "../lib/gallagher-data-service";
import {
  clearFailureBucketsForTests,
  createGallagherPinHash,
  createGallagherSession,
  gallagherSessionCookie,
  hasGallagherSession,
  pinAttemptRateLimited,
  recordFailedPinAttempt,
  verifyGallagherPin,
} from "../lib/gallagher-session";

const originalPinHash = process.env.GALLAGHER_DASHBOARD_PIN_HASH;
const originalSessionSecret = process.env.GALLAGHER_DASHBOARD_SESSION_SECRET;
const salt = Buffer.from("1234567890abcdef1234567890abcdef", "hex");
process.env.GALLAGHER_DASHBOARD_PIN_HASH = createGallagherPinHash("2580", salt);
process.env.GALLAGHER_DASHBOARD_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes";

test("correct PIN verifies against salted scrypt hash and wrong PIN fails", async () => {
  assert.equal(await verifyGallagherPin("2580"), true);
  assert.equal(await verifyGallagherPin("2581"), false);
  assert.equal(await verifyGallagherPin("not-a-pin"), false);
});

test("session token is signed, short-lived, and cookie is secure, HTTP-only and scoped", () => {
  const token = createGallagherSession();
  const request = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: gallagherSessionCookie(token).split(";")[0] } });
  assert.equal(hasGallagherSession(request), true);
  assert.match(gallagherSessionCookie(token), /HttpOnly/);
  assert.match(gallagherSessionCookie(token), /Secure/);
  assert.match(gallagherSessionCookie(token), /SameSite=Lax/);
  assert.match(gallagherSessionCookie(token), /Path=\/angel-court\/gallagher/);
  assert.match(gallagherSessionCookie(token), /Max-Age=21600/);
});

test("expired or tampered session tokens are rejected", () => {
  const secret = process.env.GALLAGHER_DASHBOARD_SESSION_SECRET!;
  const expiredPayload = Buffer.from(JSON.stringify({ v: 1, exp: 1, nonce: "abcdefghijklmnopqrstuv" })).toString("base64url");
  const expiredSignature = createHmac("sha256", secret).update(expiredPayload).digest("base64url");
  const expired = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: `fika_gallagher_session=${expiredPayload}.${expiredSignature}` } });
  assert.equal(hasGallagherSession(expired), false);
  const tampered = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: `fika_gallagher_session=${createGallagherSession()}x` } });
  assert.equal(hasGallagherSession(tampered), false);
});

test("repeated wrong PIN attempts are bounded and return 429", async () => {
  clearFailureBucketsForTests();
  const makeRequest = () => new NextRequest("https://hospitality.example/angel-court/gallagher/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify({ pin: "1111" }),
  });
  for (let index = 0; index < 5; index += 1) {
    const response = await POST(makeRequest());
    assert.equal(response.status, 401);
  }
  const limited = await POST(makeRequest());
  assert.equal(limited.status, 429);
  assert.equal(pinAttemptRateLimited(makeRequest()), true);
  clearFailureBucketsForTests();
});

test("failure counter has a hard key cap and fails closed when the cap is reached", () => {
  for (let index = 0; index < 5000; index += 1) {
    recordFailedPinAttempt(new NextRequest("https://hospitality.example/angel-court/gallagher/session", { headers: { "x-forwarded-for": `198.51.100.${index}` } }));
  }
  const overflow = new NextRequest("https://hospitality.example/angel-court/gallagher/session", { headers: { "x-forwarded-for": "192.0.2.254" } });
  recordFailedPinAttempt(overflow);
  assert.equal(pinAttemptRateLimited(overflow), true);
  assert.equal(pinAttemptRateLimited(new NextRequest("https://hospitality.example/angel-court/gallagher/session", { headers: { "x-forwarded-for": "192.0.2.253" } })), true);
  clearFailureBucketsForTests();
});

test("spoofed leading X-Forwarded-For entries cannot mint fresh rate-limit buckets", () => {
  clearFailureBucketsForTests();
  const attempt = (forged: string) => new NextRequest("https://hospitality.example/angel-court/gallagher/session", {
    headers: { "x-forwarded-for": `${forged}, 203.0.113.50` },
  });
  for (let index = 0; index < 5; index += 1) recordFailedPinAttempt(attempt(`198.51.100.${index}`));
  assert.equal(pinAttemptRateLimited(attempt("192.0.2.77")), true);
  clearFailureBucketsForTests();
});

test("an instance-wide failure ceiling stops guessing spread across many client addresses", () => {
  clearFailureBucketsForTests();
  for (let index = 0; index < 60; index += 1) {
    recordFailedPinAttempt(new NextRequest("https://hospitality.example/angel-court/gallagher/session", { headers: { "x-forwarded-for": `198.51.100.${index}` } }));
  }
  assert.equal(pinAttemptRateLimited(new NextRequest("https://hospitality.example/angel-court/gallagher/session", { headers: { "x-forwarded-for": "192.0.2.200" } })), true);
  clearFailureBucketsForTests();
});

test("customer response omits internal lineage and canonical identifiers", async () => {
  const request = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: `fika_gallagher_session=${createGallagherSession()}` } });
  const response = await gallagherDataResponse(request, {
    readLegacy: async () => [],
    readFika: async () => [{
      canonicalId: "booking:internal-1", lifecycleStatus: "Quoted", legacyBookingId: "AC-OLD",
      source: { sourceBookingId: "ANGEL-9", provider: "angel-court-hospitality", originalPayload: {} },
      client: { name: "R", email: "r@redington.co.uk", companyName: "Gallagher" },
      service: { eventDate: "2099-01-01", startTime: "09:00", guestCount: 5, portalSiteId: "angel-court" },
      order: { items: [], grossTotal: 10 },
    }],
  });
  const body = await response.json() as { bookings: Array<Record<string, unknown>> };
  assert.equal(body.bookings.length, 1);
  assert.equal(body.bookings[0].bookingReference, "ANGEL-9");
  for (const internal of ["canonicalBookingId", "supersededLegacyBookingId", "matchedBy"]) assert.equal(internal in body.bookings[0], false);
  assert.equal(JSON.stringify(body).includes("booking:internal-1"), false);
});

test("regression: a non-matching booking returned by an upstream is dropped before the browser response", async () => {
  const request = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: `fika_gallagher_session=${createGallagherSession()}` } });
  const response = await gallagherDataResponse(request, {
    readLegacy: async () => [
      { BookingID: "MINE", ClientCompany: "Qinetiq", HostEmail: "PERSON@Redington.co.uk", EventDate: "2026-10-16", GrossPrice: 1 },
      { BookingID: "THEIRS", ClientCompany: "Gallagher", HostEmail: "someone@other-tenant.example", ParsedJSON: "", EventDate: "2026-10-16", GrossPrice: 2 },
    ],
    readFika: async () => [],
  });
  const body = await response.json() as { bookings: Array<{ bookingReference: string }> };
  assert.deepEqual(body.bookings.map((booking) => booking.bookingReference), ["MINE"]);
  assert.equal(JSON.stringify(body).includes("other-tenant"), false);
});

test("data API blocks anonymous access and serves normalized data only with a valid PIN session", async () => {
  const anonymous = await getData(new NextRequest("https://hospitality.example/angel-court/gallagher/data"));
  assert.equal(anonymous.status, 401);
  let upstreamReads = 0;
  const token = createGallagherSession();
  const request = new NextRequest("https://hospitality.example/angel-court/gallagher/data", { headers: { cookie: `fika_gallagher_session=${token}` } });
  const response = await gallagherDataResponse(request, {
    readLegacy: async () => { upstreamReads += 1; return [{ BookingID: "AC-1", ClientCompany: "Gallagher", HostEmail: "person@redington.co.uk", EventDate: "2026-10-16", GrossPrice: 100 }]; },
    readFika: async () => { upstreamReads += 1; return []; },
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamReads, 2);
  const body = await response.json() as { bookings: Array<{ bookingReference: string; totalPrice: number }> };
  assert.equal(body.bookings[0].bookingReference, "AC-1");
  assert.equal(body.bookings[0].totalPrice, 100);
});

test("correct PIN creates a secure session and sign out clears it", async () => {
  clearFailureBucketsForTests();
  const request = new NextRequest("https://hospitality.example/angel-court/gallagher/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ pin: "2580" }),
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const token = setCookie.match(/fika_gallagher_session=([^;]+)/)?.[1];
  assert.ok(token);
  const signOut = await DELETE();
  assert.match(signOut.headers.get("set-cookie") || "", /Max-Age=0/);
});

test("customer data route exposes only GET and client bundle contains no Google credentials", async () => {
  const fs = await import("node:fs");
  const dataRoute = fs.readFileSync(new URL("../app/angel-court/gallagher/data/route.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../app/angel-court/gallagher/GallagherDashboard.tsx", import.meta.url), "utf8");
  assert.match(dataRoute, /export async function GET/);
  assert.doesNotMatch(dataRoute, /export async function (POST|PUT|PATCH)/);
  assert.doesNotMatch(client, /GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON|GALLAGHER_DASHBOARD_SESSION_SECRET|GALLAGHER_DASHBOARD_PIN_HASH|sheets\.googleapis\.com/);
});

test("customer header uses the approved wording and never says read-only (presentation only; data route stays GET-only)", async () => {
  const fs = await import("node:fs");
  const client = fs.readFileSync(new URL("../app/angel-court/gallagher/GallagherDashboard.tsx", import.meta.url), "utf8");
  const hero = client.slice(client.indexOf('<section className={styles.hero}'), client.indexOf("{hasData ? <SummaryTiles"));
  assert.match(hero, /Gallagher bookings/);
  assert.match(hero, /Your hospitality bookings, upcoming and past\./);
  assert.doesNotMatch(hero, /read-only|read only|readonly/i);
  assert.doesNotMatch(client, /A read-only record of your hospitality bookings/);
});

test("responsive dashboard uses cards on mobile and keeps a readable desktop table", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../app/angel-court/gallagher/GallagherDashboard.module.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.tableWrap \{ display: none; \}/);
  assert.match(css, /\.cards \{ display: grid; \}/);
  assert.match(css, /\.table \{ width: 100%; border-collapse: collapse/);
});

test.after(() => {
  clearFailureBucketsForTests();
  if (originalPinHash === undefined) delete process.env.GALLAGHER_DASHBOARD_PIN_HASH;
  else process.env.GALLAGHER_DASHBOARD_PIN_HASH = originalPinHash;
  if (originalSessionSecret === undefined) delete process.env.GALLAGHER_DASHBOARD_SESSION_SECRET;
  else process.env.GALLAGHER_DASHBOARD_SESSION_SECRET = originalSessionSecret;
});
