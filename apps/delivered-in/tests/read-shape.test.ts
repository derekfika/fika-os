import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyRequestedWeekRecoveryFailure, logRequestedWeekRecoveryFailure, resolveAccess } from "../lib/server";

test("CPU review consumption is one authenticated package request with no Delivered-In CPU reconstruction", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  assert.match(server, /readCpuDailySignedPacket/);
  assert.doesNotMatch(server, /api\/delivered-in\/review\?serviceDate=/);
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

test("requested-week recovery isolates unavailable CPU days instead of failing the whole dashboard", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/delivered-in/route.ts", import.meta.url), "utf8");
  assert.match(server, /requested-week day recovery failed/);
  assert.match(server, /Promise\.all\(dates\.map\(async date/);
  assert.match(route, /Delivered-In dashboard load failed/);
  assert.match(route, /requestedWeek/);
  assert.match(route, /recoveryAttempted/);
});

test("integrity and package misses remain explicit without index writes", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  const reconciliation = await readFile(new URL("../lib/delivered-in-reconciliation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /writeDeliveredInProjection/);
  assert.doesNotMatch(server, /updateProjectionIndex/);
  assert.match(server, /error\.message\.includes\("is unavailable\."\)/);
  assert.match(server, /CPU_DAILY_PACKET_INVALID/);
  assert.doesNotMatch(server, /readMenuPlanningWeekPackets\([^;]+\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(reconciliation, /readMenuPlanningWeekPackets\([^;]+\)\.catch\(\(\) => \[\]\)/);
});

test("Menu Planning packet integrity errors are not folded into legacy fallback", async () => {
  const packet = await readFile(new URL("../lib/menu-planning-week-packet.ts", import.meta.url), "utf8");
  assert.match(packet, /Decode outside the query compatibility catch/);
  assert.match(packet, /MENU_PLANNING_WEEK_PACKET_INVALID/);
  assert.match(packet, /if \(packets\.length\) return packets\.map\(packet => decodeMenuPlanningWeekPacket\(packet\)\)/);
  assert.match(packet, /Decode outside the query compatibility catch for the same fail-closed/);
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

test("Hub session admission survives the Delivered-In access boundary", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "FIKA_SESSION_MISSING", message: "Your FIKA OS session is missing or has expired.", requestId: "req-auth-1" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(() => resolveAccess({ headers: new Headers() } as never), (error: unknown) => {
      const value = error as { status?: number; code?: string; requestId?: string };
      return value.status === 401 && value.code === "FIKA_SESSION_MISSING" && value.requestId === "req-auth-1";
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("session failures are redirected to the standard Hub sign-in flow without retries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dashboardRoute = await readFile(new URL("../app/api/delivered-in/route.ts", import.meta.url), "utf8");
  const hubRoute = await readFile(new URL("../../integration-hub/app/api/delivered-in/access/route.ts", import.meta.url), "utf8");
  assert.match(page, /FIKA_SESSION_MISSING/);
  assert.match(page, /FIKA_SESSION_INVALID/);
  assert.match(page, /launchError/);
  assert.doesNotMatch(page, /setInterval|setTimeout/);
  assert.match(dashboardRoute, /deliveredInErrorBody/);
  assert.match(hubRoute, /admissionJson/);
});

test("requested-week recovery classifies safe stable failure codes and causes", async () => {
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("packet missing"), { code: "CPU_DAILY_PACKET_INVALID", status: 503 })).code, "CPU_DAILY_PACKET_INVALID");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("review unavailable"), { code: "CPU_REVIEW_UNAVAILABLE", status: 503 })).code, "CPU_REVIEW_UNAVAILABLE");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("review unsigned"), { code: "CPU_REVIEW_UNSIGNED", status: 503 })).code, "CPU_REVIEW_UNSIGNED");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("lineage"), { code: "CPU_REVIEW_LINEAGE_MISMATCH", status: 503 })).code, "CPU_REVIEW_LINEAGE_MISMATCH");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("wrapped"), { cause: Object.assign(new Error("missing dish"), { code: "CPU_PACKET_MISSING_DISH", status: 503 }) })).causeCode, "CPU_PACKET_MISSING_DISH");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("invalid packet"), { code: "MENU_PLANNING_WEEK_PACKET_INVALID", status: 502 })).code, "MENU_PLANNING_WEEK_PACKET_INVALID");
  assert.equal(classifyRequestedWeekRecoveryFailure(Object.assign(new Error("auth"), { code: "FIKA_SESSION_INVALID", status: 401 })).code, "FIKA_SESSION_INVALID");
});

test("requested-week recovery emits one structured, non-sensitive event", async () => {
  const server = await readFile(new URL("../lib/server.ts", import.meta.url), "utf8");
  const log = server.slice(server.indexOf("function logRequestedWeekRecoveryFailure"), server.indexOf("export function deliveredInErrorBody"));
  assert.match(server, /console\.error\(JSON\.stringify\(/);
  assert.match(server, /event: "delivered_in\.requested_week_recovery_failed"/);
  assert.match(server, /errorStatus/);
  assert.match(server, /causeCode/);
  assert.match(server, /redacted-email/);
  assert.doesNotMatch(log, /cookie|token|payload|email/i);
  const messages: string[] = [];
  const previousError = console.error;
  console.error = ((message?: unknown) => messages.push(String(message))) as typeof console.error;
  try {
    logRequestedWeekRecoveryFailure({ headers: new Headers({ "x-request-id": "req-di-003" }) } as never, "2026-09-14", "2026-09-14", "oploc:commerzbank", Object.assign(new Error("signed package unavailable"), { code: "CPU_REVIEW_UNAVAILABLE", status: 503, cause: Object.assign(new Error("staff@example.com"), { code: "INTERNAL_DETAIL" }) }));
  } finally {
    console.error = previousError;
  }
  assert.equal(messages.length, 1);
  const event = JSON.parse(messages[0]);
  assert.equal(event.event, "delivered_in.requested_week_recovery_failed");
  assert.equal(event.errorCode, "CPU_REVIEW_UNAVAILABLE");
  assert.equal(event.errorStatus, 503);
  assert.equal(event.requestId, "req-di-003");
  assert.equal(event.causeMessage, "[redacted-email]");
  assert.doesNotMatch(messages[0], /staff@example\.com/);
});

test("main dashboard reads namespaced IndexedDB before fetching changed package bodies", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cache = await readFile(new URL("../app/lib/delivered-in-indexeddb.ts", import.meta.url), "utf8");
  assert.match(page, /readCachedDeliveredInDays/);
  assert.match(page, /head=1/);
  assert.match(page, /cached\.projectionVersion === entry\.projectionVersion/);
  assert.match(page, /if \(!matches\)/);
  assert.match(page, /Published — No service \/ no menu items/);
  assert.doesNotMatch(page, /Boolean\(day && day\.entries\.length\)/);
  assert.match(page, /operationalDateLondon/);
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
