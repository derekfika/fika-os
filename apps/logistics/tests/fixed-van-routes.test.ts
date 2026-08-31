import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const mobile = readFileSync(resolve(root, "app/mobile/MobileWorkflow.tsx"), "utf8");
const route = readFileSync(resolve(root, "app/mobile/[van]/page.tsx"), "utf8");
const api = readFileSync(resolve(root, "app/api/logistics/route.ts"), "utf8");

test("fixed van routes resolve only Van 1 or Van 2 and reuse the mobile workflow", () => {
  assert.match(route, /van === "van1" \? "Van 1" : "Van 2"/);
  assert.match(route, /<MobileWorkflow fixedVan=/);
  assert.match(route, /notFound\(\)/);
  assert.match(mobile, /fixedVan \? \(data\?\.runs \|\| \[\]\)\.filter\(\(run\) => run\.vehicleLabel === fixedVan\)/);
  assert.match(mobile, /\{!fixedVan && <label>/);
  assert.match(mobile, /aria-label="Driver"/);
});

test("fixed van mobile requests and responses stay vehicle-scoped", () => {
  assert.match(mobile, /vehicle=\$\{encodeURIComponent\(fixedVan\.toLowerCase\(\)\.replace\(" ", ""\)\)\}/);
  assert.match(api, /filterLogisticsProjectionForVehicle\(projection, requestedVehicle\)/);
  assert.match(api, /vehicleContext && vehicleContext !== "van1" && vehicleContext !== "van2"/);
});

test("driver CPU navigation uses the configured browser URL", () => {
  assert.match(mobile, /process\.env\.NEXT_PUBLIC_FIKA_CPU_URL \|\| "\/"/);
  assert.doesNotMatch(mobile, /http:\/\/localhost:3400/);
});
