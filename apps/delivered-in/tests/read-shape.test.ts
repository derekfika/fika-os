import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readFileSync } from "node:fs";

test("CPU review consumption is one authenticated package request with no Delivered-In CPU reconstruction", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.match(server, /api\/delivered-in\/review\?serviceDate=/);
  assert.match(server, /stage: "cpu_review_package"/);
  assert.doesNotMatch(server, /api\/production\?/);
  assert.doesNotMatch(server, /api\/production-plan\?/);
});

test("projection invalidation is internal-only and bounded to one OPLOC/day", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/invalidate/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/delivered-in-invalidation.ts", import.meta.url), "utf8");
  assert.match(route, /x-fika-internal-token/);
  assert.match(route, /serviceDate/);
  assert.match(route, /oplocId/);
  assert.doesNotMatch(route, /reconcileDeliveredInDay|projectedWeeks/);
  assert.match(service, /markDeliveredInProjectionStale/);
});

test("ordinary projection reads are consumer-only and cannot materialise or repair packages", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /materialiseDeliveredInDay/);
  assert.match(server, /readDeliveredInProjection\(oplocId, entry\.serviceDate\)/);
  assert.match(server, /unavailableServiceDates/);
  assert.match(server, /projectionState: discovered\.state/);
});

test("integrity and package misses remain explicit without index writes", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /writeDeliveredInProjection/);
  assert.doesNotMatch(server, /updateProjectionIndex/);
  assert.match(server, /catch \{\s+return undefined;/);
});

test("standalone Delivered-In has no idle polling and selected access remains request-scoped", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const grabAndGo = await readFile(new URL("../app/grab-and-go-view.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(page, /setInterval|setTimeout/);
  assert.doesNotMatch(grabAndGo, /setInterval|setTimeout/);
  assert.match(server, /assertAuthorisedOploc\(access, selectedOplocId\)/);
  assert.match(server, /stage: "cpu_review_package"/);
});

test("main dashboard reads namespaced IndexedDB before fetching changed package bodies", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cache = await readFile(new URL("../app/lib/delivered-in-indexeddb.ts", import.meta.url), "utf8");
  assert.match(page, /readCachedDeliveredInDays/);
  assert.match(page, /head=1/);
  assert.match(page, /cached\.projectionVersion === entry\.projectionVersion/);
  assert.match(page, /if \(!matches\)/);
  assert.match(cache, /accountScope === accountScope && value\.oplocId === oplocId/);
});

test("Grab & Go CPU feed requires the service boundary and applies the requested delivery date", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/grab-and-go/production/route.ts", import.meta.url), "utf8");
  assert.match(route, /assertCpuBoundary/);
  assert.match(route, /deliveryDate/);
  assert.match(route, /order\.status === "submitted"/);
});

test("hosted Delivered-In persistence uses bounded Firestore keys and range queries", async () => {
  const orders = await readFile(new URL("../lib/grab-and-go-store.ts", import.meta.url), "utf8");
  const siteMenus = await readFile(new URL("../lib/site-menu-store.ts", import.meta.url), "utf8");
  assert.match(orders, /stableDocumentId\(`grab-and-go:\$\{oplocId\}:\$\{deliveryDate\}`\)/);
  assert.match(orders, /\.where\("oplocId", "==", oplocId\)/);
  assert.match(orders, /\.where\("deliveryDate", ">=", startDate\)/);
  assert.match(orders, /\.limit\(100\)/);
  assert.match(siteMenus, /stableDocumentId\(`\$\{oplocId\}:\$\{sourceDayId\}`\)/);
  assert.match(siteMenus, /collection\("revisions"\)/);
  assert.doesNotMatch(orders, /if \(!hosted\(\)\)[\s\S]*hostedOrders\(\)\.get/);
});

test("Delivered-In publication projection requests an explicit bounded week range", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../../menu-planning/app/api/rolling-menu/publications/route.ts", import.meta.url), "utf8");
  assert.match(server, /publications\?fromWeek=/);
  assert.match(server, /toWeek=/);
  assert.match(route, /listMenuPublicationsForDateRange/);
  assert.match(route, /fromWeek >= toWeek/);
});

test("hosted migration is dry-run by default and chunks writes", async () => {
  const migration = await readFile(new URL("../scripts/migrate-hosted-persistence.ts", import.meta.url), "utf8");
  assert.match(migration, /if \(!apply\) process\.exit\(0\)/);
  assert.match(migration, /offset \+= 400/);
  assert.match(migration, /Invalid migration source/);
});

test("Delivered-In Google generation reuses DWD in hosted mode and local OAuth only locally", async () => {
  const google = await readFile(new URL("../lib/google-site-menu.ts", import.meta.url), "utf8");
  const owner = await readFile(new URL("../../../packages/server-shared/src/drive-owner.ts", import.meta.url), "utf8");
  assert.match(google, /resolveDriveOwner\(\{ type: "app-workspace", appId: "delivered-in" \}\)/);
  assert.match(google, /driveAccessToken\(owner\)/);
  assert.match(owner, /appId: "cpu-production" \| "delivered-in"/);
  assert.doesNotMatch(google, /process\.env\.GOOGLE_OAUTH_CLIENT_FILE/);
});

test("Delivered-In production dependency graph has no sibling application source imports", async () => {
  const productionClient = await readFile(new URL("../lib/production-client.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/delivered-in/grab-and-go/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(productionClient, /integration-hub|hospitality-booking|menu-planning|ad-hoc-production/);
  assert.doesNotMatch(route, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared/);
});
test("Delivered-In access attribution uses the Delivered-In dataset", () => {
  const source = readFileSync(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.match(source, /dataset: "integration-hub\/delivered-in-access"/);
  assert.doesNotMatch(source, /dataset: "integration-hub\/logistics-access"/);
});
