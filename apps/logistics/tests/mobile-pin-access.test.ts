import assert from "node:assert/strict";
import test from "node:test";
import { assertMobilePinAction, requireLogisticsAccess } from "../lib/auth";
import { vehicleScope } from "../lib/resource-authority";

function request(pathname: string, vehicle?: string) {
  return {
    method: "GET",
    url: `https://logistics-staging.fikacatering.com${pathname}`,
    cookies: { get: () => ({ value: "signed-session-cookie" }) },
    headers: new Headers({ "x-fika-logistics-mobile-request": "1", "x-fika-logistics-vehicle": "van1" }),
    nextUrl: { pathname, searchParams: new URLSearchParams(vehicle ? { vehicle } : {}) },
  };
}

test("mobile PIN access is vehicle-scoped and does not consult Hub identity grants", async () => {
  const principal = await requireLogisticsAccess(request("/api/logistics", "van1"), { allowLocalFallback: false, mobileSessionReader: async () => ({ vehicleId: "van1", sessionId: "session-1234567890123456" }) });
  assert.equal(principal.sessionKind, "mobile-pin");
  assert.deepEqual(principal.permittedVehicleIds, ["van1"]);
  assert.equal(principal.authmodIdentityId, undefined);
  assert.deepEqual(vehicleScope({ ...principal, desktopPermissions: { view: true, manage: true } }), ["van1"]);
});

test("mobile PIN access denies URL vehicle switching and unrelated planner routes", async () => {
  await assert.rejects(() => requireLogisticsAccess(request("/api/logistics", "van2"), { mobileSessionReader: async () => ({ vehicleId: "van1", sessionId: "session-1234567890123456" }) }), /requested vehicle/);
  await assert.rejects(() => requireLogisticsAccess(request("/api/logistics/drivers"), { mobileSessionReader: async () => ({ vehicleId: "van1", sessionId: "session-1234567890123456" }) }), /cannot access/);
});

test("mobile API rejects absent or invalid session and direct requests without the mobile marker remain on Hub auth", async () => {
  await assert.rejects(() => requireLogisticsAccess(request("/api/logistics"), { mobileSessionReader: async () => undefined, allowLocalFallback: false }), /valid vehicle PIN session/);
  const desktop = request("/api/logistics");
  desktop.headers = new Headers();
  await assert.rejects(() => requireLogisticsAccess(desktop, { sessionReader: async () => { throw Object.assign(new Error("Hub session required"), { status: 401 }); }, allowLocalFallback: false }), /Hub session required/);
});

test("mobile PIN session accepts only driver execution actions", () => {
  for (const action of ["arrive-stop", "mark-stop-loaded", "mark-subload-loaded", "complete-stop", "report-issue", "dispatch-run"]) assert.doesNotThrow(() => assertMobilePinAction(action));
  for (const action of ["create-run", "assign-job-to-load", "set-run-driver", "reconcile-logistics-day", "reset-logistics-data"]) assert.throws(() => assertMobilePinAction(action), /planner operations/);
});
