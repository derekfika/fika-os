import assert from "node:assert/strict";
import test from "node:test";
import { requireLogisticsAccess } from "../lib/auth";
import { MOBILE_VEHICLE_HEADER, clearMobileCookie, mobileCookie, mobileSessionCookieName, signMobilePinSession, verifyMobilePinSession } from "../lib/mobile-pin-session";

const SECRET = "dual-van-test-secret-0123456789abcdef";
const VERIFIER = { van1: "van1-verifier-fixture", van2: "van2-verifier-fixture" };

function withEnv<T>(run: () => Promise<T>) {
  const previous = { secret: process.env.LOGISTICS_MOBILE_SESSION_SECRET, van1: process.env.LOGISTICS_MOBILE_VAN1_PIN_VERIFIER, van2: process.env.LOGISTICS_MOBILE_VAN2_PIN_VERIFIER };
  process.env.LOGISTICS_MOBILE_SESSION_SECRET = SECRET;
  process.env.LOGISTICS_MOBILE_VAN1_PIN_VERIFIER = VERIFIER.van1;
  process.env.LOGISTICS_MOBILE_VAN2_PIN_VERIFIER = VERIFIER.van2;
  return run().finally(() => {
    process.env.LOGISTICS_MOBILE_SESSION_SECRET = previous.secret;
    process.env.LOGISTICS_MOBILE_VAN1_PIN_VERIFIER = previous.van1;
    process.env.LOGISTICS_MOBILE_VAN2_PIN_VERIFIER = previous.van2;
  });
}

// Each van signs in on its own device, so the browser holds one cookie per van.
const cookiesFor = (vans: Array<"van1" | "van2">) => {
  const jar = new Map(vans.map(van => [mobileSessionCookieName(van), signMobilePinSession({ vehicleId: van, verifier: VERIFIER[van], secret: SECRET })]));
  return { get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) };
};
const mobileRequest = (vehicleHeader: string | undefined, cookies: ReturnType<typeof cookiesFor>) => ({
  method: "GET",
  url: "https://logistics-staging.fikacatering.com/api/logistics",
  cookies,
  headers: new Headers({ "x-fika-logistics-mobile-request": "1", ...(vehicleHeader ? { [MOBILE_VEHICLE_HEADER]: vehicleHeader } : {}) }),
  nextUrl: { pathname: "/api/logistics", searchParams: new URLSearchParams() },
});

test("each van has its own cookie name, so signing one van in never replaces the other", () => {
  assert.notEqual(mobileSessionCookieName("van1"), mobileSessionCookieName("van2"));
  assert.match(mobileCookie("token", false, "van1"), new RegExp(`^${mobileSessionCookieName("van1")}=token;`));
  assert.match(mobileCookie("token", false, "van2"), new RegExp(`^${mobileSessionCookieName("van2")}=token;`));
  assert.match(clearMobileCookie(false, "van1"), new RegExp(`^${mobileSessionCookieName("van1")}=;`));
  assert.doesNotMatch(clearMobileCookie(false, "van1"), new RegExp(mobileSessionCookieName("van2")));
});

test("a session signed for one van does not verify as the other", () => {
  const token = signMobilePinSession({ vehicleId: "van1", verifier: VERIFIER.van1, secret: SECRET });
  assert.ok(verifyMobilePinSession(token, { secret: SECRET, verifiers: { van1: VERIFIER.van1 } }));
  assert.equal(verifyMobilePinSession(token, { secret: SECRET, verifiers: { van2: VERIFIER.van2 } }), undefined);
});

test("two vans signed in at once: each request acts only as the van it names", () => withEnv(async () => {
  const both = cookiesFor(["van1", "van2"]);
  const one = await requireLogisticsAccess(mobileRequest("van1", both), { allowLocalFallback: false });
  assert.deepEqual(one.permittedVehicleIds, ["van1"]);
  const two = await requireLogisticsAccess(mobileRequest("van2", both), { allowLocalFallback: false });
  assert.deepEqual(two.permittedVehicleIds, ["van2"]);
}));

test("a Van 1 cookie can never satisfy a Van 2 request", () => withEnv(async () => {
  const onlyVan1 = cookiesFor(["van1"]);
  await assert.rejects(() => requireLogisticsAccess(mobileRequest("van2", onlyVan1), { allowLocalFallback: false }), /valid vehicle PIN session/);
}));

test("a mobile request with no vehicle named is rejected rather than guessing", () => withEnv(async () => {
  await assert.rejects(() => requireLogisticsAccess(mobileRequest(undefined, cookiesFor(["van1", "van2"])), { allowLocalFallback: false }), /valid vehicle PIN session/);
  await assert.rejects(() => requireLogisticsAccess(mobileRequest("van3", cookiesFor(["van1", "van2"])), { allowLocalFallback: false }), /valid vehicle PIN session/);
}));
