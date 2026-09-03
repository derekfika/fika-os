import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const text = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("manager allergen route is a fail-closed tombstone and permission is retired", () => {
  const route = text("../app/api/delivered-in/allergens/route.ts");
  const access = text("../../../packages/server-shared/src/delivered-in-access.ts");
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /projectedAllergenDay/);
  assert.doesNotMatch(access, /delivered_in\.allergens\.view/);
});

test("maintenance and reconciliation routes require explicit service authentication", () => {
  assert.match(text("../app/api/delivered-in/reconcile/route.ts"), /requireDeliveredInMaintenance\(request\)/);
  assert.match(text("../app/api/delivered-in/site-menu/route.ts"), /requireDeliveredInMaintenance\(request\)/);
});

test("ordinary CPU reads use the daily signed packet adapter and do not call review reconstruction", () => {
  const server = text("../lib/server.ts");
  assert.match(server, /readCpuDailySignedPacket/);
  assert.doesNotMatch(server, /api\/delivered-in\/review/);
  assert.doesNotMatch(server, /CPU_PRODUCTION_BASE_URL/);
});
