import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const mobile = readFileSync(resolve(root, "app/mobile/MobileWorkflow.tsx"), "utf8");
const route = readFileSync(resolve(root, "app/mobile/[van]/page.tsx"), "utf8");
const api = readFileSync(resolve(root, "app/api/logistics/route.ts"), "utf8");
const gate = readFileSync(resolve(root, "app/mobile/MobilePinGate.tsx"), "utf8");
const middleware = readFileSync(resolve(root, "middleware.ts"), "utf8");

test("fixed van routes resolve only Van 1 or Van 2 and reuse the mobile workflow", () => {
  assert.match(route, /van === "van1" \? "Van 1" : "Van 2"/);
  assert.match(route, /<MobilePinGate vehicle=/);
  assert.match(route, /notFound\(\)/);
  assert.match(mobile, /selectMobileVehicleRuns\(visibleData\?\.runs/);
  assert.match(mobile, /authority\.vehicles\.includes\(selectedVehicle/);
  assert.match(mobile, /\{!fixedVan && <label>/);
  assert.match(mobile, /aria-label="Vehicle"/);
  assert.match(mobile, /aria-label="Run"/);
  assert.doesNotMatch(mobile, /aria-label="Driver"/);
});

test("fixed van mobile requests and responses stay vehicle-scoped", () => {
  assert.match(mobile, /vehicle=\$\{encodeURIComponent\(fixedVan\.toLowerCase\(\)\.replace\(" ", ""\)\)\}/);
  assert.match(api, /scopeCanonicalProjection\(projection, principal, vehicleContext\)/);
  assert.match(api, /vehicleContext && vehicleContext !== "van1" && vehicleContext !== "van2"/);
});

test("fixed-vehicle mobile pages require a vehicle PIN before rendering the workflow", () => {
  assert.match(gate, /api\/logistics\/mobile\/session\?vehicle=\$\{id\}/);
  assert.match(gate, /vehicleId: id, pin/);
  assert.match(gate, /type="password"/);
  assert.doesNotMatch(gate, /localStorage|sessionStorage/);
  assert.match(middleware, /x-fika-logistics-mobile-request/);
  assert.match(api, /sessionKind === "mobile-pin"/);
});

test("driver CPU navigation uses the configured browser URL", () => {
  assert.match(mobile, /process\.env\.NEXT_PUBLIC_FIKA_CPU_URL \|\| "\/"/);
  assert.doesNotMatch(mobile, /http:\/\/localhost:3400/);
});
