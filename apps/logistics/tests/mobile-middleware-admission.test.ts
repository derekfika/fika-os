import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

// The hosted runtime is where this admission shortcut applies, so these tests run in it. A unit test outside the hosted runtime
// cannot see a middleware/cookie-name mismatch.
function inHostedRuntime<T>(run: () => Promise<T>) {
  const overrides: Record<string, string | undefined> = { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_ALLOWED_EMAIL_DOMAINS: "fikacatering.com", FIKA_HUB_BASE_URL: undefined };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return run().finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

function request(pathname: string, headers: Record<string, string>, cookie?: string) {
  return new NextRequest(`https://logistics-staging.fikacatering.com${pathname}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}
const admitted = (response: Response) => response.headers.get("x-middleware-next") === "1";
const mobileHeaders = (vehicle?: string) => ({ "x-fika-logistics-mobile-request": "1", ...(vehicle ? { "x-fika-logistics-vehicle": vehicle } : {}) });

test("a van's own session cookie admits that van's API requests in the hosted runtime", () => inHostedRuntime(async () => {
  assert.ok(admitted(await middleware(request("/api/logistics", mobileHeaders("van1"), "fika_logistics_mobile_session_van1=token"))));
  assert.ok(admitted(await middleware(request("/api/logistics/vehicles", mobileHeaders("van2"), "fika_logistics_mobile_session_van2=token"))));
}));

test("both vans signed in at once: each request is admitted by its own cookie", () => inHostedRuntime(async () => {
  const both = "fika_logistics_mobile_session_van1=a; fika_logistics_mobile_session_van2=b";
  assert.ok(admitted(await middleware(request("/api/logistics", mobileHeaders("van1"), both))));
  assert.ok(admitted(await middleware(request("/api/logistics", mobileHeaders("van2"), both))));
}));

test("a Van 1 cookie never admits a request that names Van 2", () => inHostedRuntime(async () => {
  assert.equal(admitted(await middleware(request("/api/logistics", mobileHeaders("van2"), "fika_logistics_mobile_session_van1=token"))), false);
}));

test("a mobile request that names no valid van, or carries only the old cookie name, is not admitted", () => inHostedRuntime(async () => {
  assert.equal(admitted(await middleware(request("/api/logistics", mobileHeaders(), "fika_logistics_mobile_session_van1=token"))), false);
  assert.equal(admitted(await middleware(request("/api/logistics", mobileHeaders("van3"), "fika_logistics_mobile_session_van3=token"))), false);
  assert.equal(admitted(await middleware(request("/api/logistics", mobileHeaders("van1"), "fika_logistics_mobile_session=token"))), false);
}));

test("the shortcut is limited to the two driver API paths", () => inHostedRuntime(async () => {
  assert.equal(admitted(await middleware(request("/api/logistics/drivers", mobileHeaders("van1"), "fika_logistics_mobile_session_van1=token"))), false);
}));
