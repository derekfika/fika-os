import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { clearFailureBucketsForTests, createGallagherPinHash, createGallagherSession, GALLAGHER_COOKIE, hasGallagherSession } from "../lib/gallagher-session";
import {
  clearRcoaFailureBucketsForTests,
  createRcoaPinHash,
  createRcoaSession,
  hasRcoaSession,
  rcoaPinAttemptRateLimited,
  RCOA_COOKIE_PATH,
  rcoaSessionCookie,
  recordRcoaFailedPinAttempt,
  verifyRcoaPin,
} from "../lib/rcoa-dashboard/session";
import { rcoaDashboardDataResponse } from "../lib/rcoa-dashboard/data-service";
import type { RcoaDashboardService } from "../lib/rcoa-dashboard/model";
import { DELETE as signOut, POST as signIn } from "../app/rcoa/bookings/api/session/route";
import { rcoaDashboardConfig } from "../lib/rcoa-dashboard/config";

const env = process.env;
const original = {
  RCOA_DASHBOARD_PIN_HASH: env.RCOA_DASHBOARD_PIN_HASH,
  RCOA_DASHBOARD_SESSION_SECRET: env.RCOA_DASHBOARD_SESSION_SECRET,
  GALLAGHER_DASHBOARD_PIN_HASH: env.GALLAGHER_DASHBOARD_PIN_HASH,
  GALLAGHER_DASHBOARD_SESSION_SECRET: env.GALLAGHER_DASHBOARD_SESSION_SECRET,
};
function restore() {
  for (const [key, value] of Object.entries(original)) if (value === undefined) delete env[key]; else env[key] = value;
  clearFailureBucketsForTests();
  clearRcoaFailureBucketsForTests();
}
function rcoaRequest(token: string, forwarded = "198.51.100.8, 203.0.113.9") {
  return new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api", { headers: { cookie: `fika_rcoa_dashboard_session=${token}`, "x-forwarded-for": forwarded } });
}

test("RCoA PIN/session settings are isolated from Gallagher and cookies are route-scoped", async () => {
  assert.ok(rcoaDashboardConfig.dataPath.startsWith(`${RCOA_COOKIE_PATH}/`));
  assert.ok(rcoaDashboardConfig.sessionPath.startsWith(`${RCOA_COOKIE_PATH}/`));
  env.RCOA_DASHBOARD_PIN_HASH = createRcoaPinHash("123456", Buffer.alloc(16, 1));
  env.RCOA_DASHBOARD_SESSION_SECRET = "rcoa-session-secret-which-is-independent-0123456789";
  env.GALLAGHER_DASHBOARD_PIN_HASH = createGallagherPinHash("1234", Buffer.alloc(16, 2));
  env.GALLAGHER_DASHBOARD_SESSION_SECRET = "gallagher-session-secret-which-is-independent-0123456789";
  assert.equal(await verifyRcoaPin("123456"), true);
  assert.equal(await verifyRcoaPin("1234"), false);
  assert.throws(() => createRcoaPinHash("12345", Buffer.alloc(16, 1)), /6–12 digit/);
  const token = createRcoaSession();
  assert.equal(hasRcoaSession(rcoaRequest(token)), true);
  assert.equal(hasGallagherSession(rcoaRequest(token)), false);
  const gallagherCookie = createGallagherSession();
  const onlyGallagher = new NextRequest("https://hospitality.fikacatering.com/angel-court/gallagher/data", { headers: { cookie: `${GALLAGHER_COOKIE}=${gallagherCookie}` } });
  assert.equal(hasGallagherSession(onlyGallagher), true);
  assert.equal(hasRcoaSession(onlyGallagher), false);
  assert.match(rcoaSessionCookie(token), /Path=\/rcoa\/bookings;.*HttpOnly; Secure; SameSite=Lax/);
  restore();
});

test("RCoA signed sessions reject tampering and enforce expiry", () => {
  env.RCOA_DASHBOARD_SESSION_SECRET = "rcoa-session-secret-which-is-independent-0123456789";
  const token = createRcoaSession();
  assert.equal(hasRcoaSession(rcoaRequest(`${token}x`)), false);
  const expired = Buffer.from(JSON.stringify({ v: 1, exp: 1, nonce: "abcdefghijklmnopqrstuvwx" })).toString("base64url");
  const signature = createHmac("sha256", env.RCOA_DASHBOARD_SESSION_SECRET).update(expired).digest("base64url");
  assert.equal(hasRcoaSession(rcoaRequest(`${expired}.${signature}`)), false);
  restore();
});

test("RCoA PIN attempts rate limit on the trusted rightmost forwarded hop", () => {
  clearRcoaFailureBucketsForTests();
  const first = rcoaRequest("unused", "forged-one, trusted-edge");
  for (let attempt = 0; attempt < 5; attempt += 1) recordRcoaFailedPinAttempt(first);
  assert.equal(rcoaPinAttemptRateLimited(rcoaRequest("unused", "forged-two, trusted-edge")), true);
  assert.equal(rcoaPinAttemptRateLimited(rcoaRequest("unused", "forged-two, different-edge")), false);
  restore();
});

test("RCoA session route fails closed, rate limits bad PINs, and issues an isolated secure cookie", async () => {
  clearRcoaFailureBucketsForTests();
  delete env.RCOA_DASHBOARD_PIN_HASH;
  delete env.RCOA_DASHBOARD_SESSION_SECRET;
  const unconfigured = await signIn(new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api/session", { method: "POST", body: JSON.stringify({ pin: "123456" }) }));
  assert.equal(unconfigured.status, 503);
  env.RCOA_DASHBOARD_PIN_HASH = createRcoaPinHash("123456", Buffer.alloc(16, 3));
  env.RCOA_DASHBOARD_SESSION_SECRET = "rcoa-session-secret-which-is-independent-0123456789";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await signIn(new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `spoof-${attempt}, trusted-login-hop` }, body: JSON.stringify({ pin: "000000" }) }));
    assert.equal(response.status, 401);
  }
  const limited = await signIn(new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "new-spoof, trusted-login-hop" }, body: JSON.stringify({ pin: "123456" }) }));
  assert.equal(limited.status, 429);
  const signedIn = await signIn(new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "trusted-new-hop" }, body: JSON.stringify({ pin: "123456" }) }));
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get("set-cookie") || "", /fika_rcoa_dashboard_session=.*Path=\/rcoa\/bookings;.*HttpOnly; Secure; SameSite=Lax/);
  const signedOut = await signOut();
  assert.match(signedOut.headers.get("set-cookie") || "", /fika_rcoa_dashboard_session=; Path=\/rcoa\/bookings; Max-Age=0/);
  restore();
});

test("RCoA dashboard data requires a session and returns only grouped safe fields", async () => {
  env.RCOA_DASHBOARD_SESSION_SECRET = "rcoa-session-secret-which-is-independent-0123456789";
  const unsafeRead = async () => { throw new Error("must not read without a session"); };
  const denied = await rcoaDashboardDataResponse(new NextRequest("https://hospitality.fikacatering.com/rcoa/bookings/api"), { readBookings: unsafeRead });
  assert.equal(denied.status, 401);
  const token = createRcoaSession();
  const fixture: RcoaDashboardService[] = [
    { reference: "RCOA-G1-1", eventType: "Breakfast", eventDate: "2099-11-18", startTime: "09:00", endTime: "10:00", location: "Suite", guestCount: 20, lifecycleStatus: "Approved", amended: false, groupId: "private-id", groupSize: 2, groupSequence: 1, items: [{ name: "Tea", quantity: 1 }] },
    { reference: "RCOA-G1-2", eventType: "Lunch", eventDate: "2099-11-18", startTime: "12:00", endTime: "13:00", location: "Suite", guestCount: 18, lifecycleStatus: "Approved", amended: true, groupId: "private-id", groupSize: 2, groupSequence: 2, items: [{ name: "Sandwiches", quantity: 18 }] },
  ];
  const allowed = await rcoaDashboardDataResponse(rcoaRequest(token), { readBookings: async () => fixture });
  assert.equal(allowed.status, 200);
  const body = await allowed.json() as { bookings: Array<Record<string, unknown>>; counts: Record<string, number> };
  assert.equal(body.bookings.length, 1);
  assert.equal(body.bookings[0].displayStatus, "Amended");
  assert.equal(body.bookings[0].guestCount, null);
  assert.equal("groupId" in body.bookings[0], false);
  assert.equal("services" in body.bookings[0], true);
  assert.equal(JSON.stringify(body).includes("private-id"), false);
  assert.equal(JSON.stringify(body).includes("email"), false);
  assert.equal(JSON.stringify(body).includes("price"), false);
  assert.equal(body.counts.total, 1);
  restore();
});
