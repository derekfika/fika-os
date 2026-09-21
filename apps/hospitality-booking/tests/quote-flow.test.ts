import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const menusRoute = readFileSync(new URL("../app/api/menus/route.ts", import.meta.url), "utf8");

test("quote generation stays on the dashboard and bounds remote persistence waits", () => {
  assert.doesNotMatch(dashboard, /window\.open\("", "_blank"\)/);
  assert.match(dashboard, /fetchQuoteRequest/);
  assert.match(dashboard, /QUOTE_REQUEST_TIMEOUT_MS/);
  assert.match(dashboard, /void load\(action !== "Quoted"\)/);
  assert.match(dashboard, /Retry quote PDF save/);
});

test("menu readiness follows the current amended Production Order identity", () => {
  assert.match(dashboard, /productionOrderId=\$\{encodeURIComponent\(productionOrderId\)\}/);
  assert.match(menusRoute, /request\.nextUrl\.searchParams\.get\("productionOrderId"\)/);
  assert.match(menusRoute, /productionOrderCandidates\(booking\.canonicalId/);
  assert.match(menusRoute, /fetchCpuProductionPlan\(request/);
  assert.match(menusRoute, /cpuNotFound\(response/);
  assert.match(menusRoute, /cpuBodyErrorMessage\(body, response\.status\)/);
  assert.match(dashboard, /body\.error\?\.message \|\| body\.readiness\?\.reason/);
});
