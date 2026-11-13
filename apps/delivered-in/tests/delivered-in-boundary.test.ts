import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertAuthorisedOploc } from "../lib/projection";

const text = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("manager allergen route is a fail-closed tombstone and permission is retired", () => {
  const route = text("../app/api/delivered-in/allergens/route.ts");
  const access = text("../../../packages/server-shared/src/delivered-in-access.ts");
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /projectedAllergenDay/);
  assert.doesNotMatch(access, /delivered_in\.allergens\.view/);
});

test("site menu generation uses existing scoped site access while maintenance reconciliation stays service-only", () => {
  const siteMenu = text("../app/api/delivered-in/site-menu/route.ts");
  assert.doesNotMatch(siteMenu, /requireDeliveredInMaintenance\(request\)/);
  assert.match(siteMenu, /resolveAccess\(request, "delivered-in", \{ siteMenuGenerationFor: body\.oplocId \}\)/);
  assert.match(siteMenu, /access\.siteMenuGeneration\?\.oplocId !== body\.oplocId \|\| !access\.siteMenuGeneration\.allowed/);
  assert.match(siteMenu, /projectedAllergenDay\(request, body\.oplocId, body\.publicationDayId, \{ authoritative: true \}\)/);
  assert.match(siteMenu, /assertAuthorisedOploc\(access\.access, body\.oplocId\)/);
  assert.match(siteMenu, /access\.sites\.some\(site => site\.oplocId === body\.oplocId && !site\.destination\)/);
  assert.match(siteMenu, /day\.cpuReview\?\.status !== "signed"/);
  assert.match(siteMenu, /createGoogleSiteMenu\(day, day\.site, access\.access\.email/);

  const mnk = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
  const oac = "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10";
  const existingMnkAccess = { email: "mnk@fikacatering.com", oplocIds: [mnk], permissions: ["delivered_in.view"] };
  assert.doesNotThrow(() => assertAuthorisedOploc(existingMnkAccess, mnk));
  assert.throws(() => assertAuthorisedOploc(existingMnkAccess, oac), (error: any) => error.status === 403);
  const hubAccess = text("../../integration-hub/app/api/delivered-in/access/route.ts");
  assert.match(hubAccess, /resource: "delivered-in\.normal",\s*action: "Manage",\s*scope: \{ kind: "oploc", ids: \[siteMenuGenerationFor\] \}/);

  assert.match(text("../app/api/delivered-in/reconcile/route.ts"), /requireDeliveredInMaintenance\(request\)/);
});

test("ordinary CPU reads use the daily signed packet adapter and do not call review reconstruction", () => {
  const server = text("../lib/server.ts");
  assert.match(server, /readCpuDailySignedPacket/);
  assert.doesNotMatch(server, /api\/delivered-in\/review/);
  assert.doesNotMatch(server, /CPU_PRODUCTION_BASE_URL/);
});
