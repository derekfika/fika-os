import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drainIncrementalPages } from "../lib/incremental-sync";
import { logisticsCacheKey } from "../lib/logistics-cache";
import { logisticsCacheScope } from "../lib/auth";

const root = resolve(import.meta.dirname, "..");
const store = readFileSync(resolve(root, "lib/store.ts"), "utf8");
const route = readFileSync(resolve(root, "app/api/logistics/route.ts"), "utf8");
const page = readFileSync(resolve(root, "app/page.tsx"), "utf8");
const passiveRefresh = readFileSync(resolve(root, "lib/passive-refresh.ts"), "utf8");
const api = readFileSync(resolve(root, "lib/api.ts"), "utf8");
const indexes = readFileSync(resolve(root, "firestore.indexes.json"), "utf8");

test("incremental changes are ordered, cursor-based, and capped", () => {
  const changes = store.slice(store.indexOf("export async function listLogisticsChanges"));
  assert.match(changes, /where\("sequence", ">", after\)/);
  assert.match(changes, /orderBy\("sequence", "asc"\)/);
  assert.match(changes, /limit\(LOGISTICS_CHANGE_LIMIT \+ 1\)/);
  assert.match(changes, /hasMore: snapshot\.size > LOGISTICS_CHANGE_LIMIT/);
});

test("dashboard polling has separate bounded cadences", () => {
  assert.match(passiveRefresh, /PASSIVE_REFRESH_INTERVAL_MS = 15 \* 60_000/);
  assert.match(page, /setInterval[\s\S]*PASSIVE_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(page, /}, 30_000\)/);
  assert.doesNotMatch(page, /}, 5 \* 60_000\)/);
  assert.match(page, /lastPassiveSyncAt\.current/);
  assert.match(page, /mayRequestPassiveRefresh/);
  assert.match(page, /requestPassiveRefresh\("interval"\)/);
  assert.match(page, /requestPassiveRefresh\("visibility"\)/);
  assert.match(page, /requestPassiveRefresh\("broadcast"\)/);
  assert.match(page, /planningAttention=1/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /syncHead=1/);
  assert.match(page, /cached && Number\(head\.sequence\) === cached\.lastChangeSequence/);
  assert.match(page, /ensure-vehicle-day-runs/);
  assert.match(page, /if \(result\.changed\) \{[\s\S]*const refreshed = await load\(true\);[\s\S]*if \(refreshed\.ok\) await loadWeek\(\)/);
});

test("day freshness uses a date-scoped cursor and bounded return-to-planning reads", () => {
  assert.match(store, /export const logisticsDayCursorId = \(serviceDate: string\)/);
  assert.match(store, /export async function getLogisticsSyncHead\(serviceDate\?: string\)/);
  assert.match(store, /sync-head\.legacy-projection-fallback/);
  assert.match(route, /getLogisticsSyncHead\(serviceDate\)/);
  const returnBranch = route.slice(route.indexOf('body.action === "return-stop-to-planning"'), route.indexOf('body.action === "move-stop"'));
  assert.match(returnBranch, /runs\(\)\.where\("serviceDate", "==", run\.serviceDate\)/);
  assert.match(returnBranch, /where\("runId", "in", runIds\.slice\(index \* 30, index \* 30 \+ 30\)\)/);
  assert.doesNotMatch(returnBranch, /stops\(\)\.get\(\)|runs\(\)\.get\(\)/);
});

test("projection reads do not trigger write-producing reconciliation", () => {
  const projectionBranch = route.slice(route.indexOf('if (request.nextUrl.searchParams.get("projection") === "1")'), route.indexOf('if (request.nextUrl.searchParams.get("syncHead") === "1")'));
  assert.doesNotMatch(projectionBranch, /reconcileLogisticsDay|rebuildLogisticsProjection|repairLegacyAssignmentServiceDates/);
  assert.match(projectionBranch, /side-effect free/);
});

test("week summaries request Hub fulfilment by service date", () => {
  const weekBranch = route.slice(route.indexOf("if (requestedWeek)"), route.indexOf("const requestedRun = requestedRunId"));
  assert.doesNotMatch(weekBranch, /fetchRequirements\(undefined/);
  assert.match(weekBranch, /fetchRequirementsForDateRange\(dates\[0\], addOperationalDays\(dates\[4\], 1\), cookie\)/);
  const attentionBranch = route.slice(route.indexOf('if (request.nextUrl.searchParams.get("planningAttention")'), route.indexOf('if (request.nextUrl.searchParams.has("changesSince")'));
  assert.doesNotMatch(attentionBranch, /Promise\.all\(serviceDates\.map\(\(serviceDate\) => fetchRequirements/);
  assert.match(attentionBranch, /fetchRequirementsForDateRange\(serviceDates\[0\], addOperationalDays\(serviceDates\[days - 1\], 1\), cookie\)/);
});

test("incremental backlog drains more than one 200-event page in order", async () => {
  const cursors: number[] = [];
  const result = await drainIncrementalPages(0, async (cursor) => {
    cursors.push(cursor);
    return { nextCursor: cursor + 200, hasMore: cursor < 400, projection: cursor + 200 };
  });
  assert.deepEqual(cursors, [0, 200, 400]);
  assert.equal(result.cursor, 600);
  assert.equal(result.latestProjection, 600);
});

test("incremental backlog stops on a repeated cursor", async () => {
  let calls = 0;
  const result = await drainIncrementalPages(10, async () => {
    calls += 1;
    return { nextCursor: 20, hasMore: true };
  });
  assert.equal(calls, 2);
  assert.equal(result.cursor, 20);
});

test("incremental drain includes a sequence that advances while earlier pages are processed", async () => {
  const cursors: number[] = [];
  let concurrentSequence = 400;
  const result = await drainIncrementalPages(0, async (cursor) => {
    cursors.push(cursor);
    if (cursor === 0) return { nextCursor: 200, hasMore: true, projection: 200 };
    if (cursor === 200) { concurrentSequence = 450; return { nextCursor: 400, hasMore: true, projection: 400 }; }
    return { nextCursor: concurrentSequence, hasMore: false, projection: concurrentSequence };
  });
  assert.deepEqual(cursors, [0, 200, 400]);
  assert.equal(result.cursor, 450);
  assert.equal(result.latestProjection, 450);
});

test("single-record mutation lookups use deterministic document IDs", () => {
  assert.match(store, /export async function getRun\(runId: string\)[\s\S]*runs\(\)\.doc\(runId\)\.get\(\)/);
  assert.match(store, /export async function getLogisticsJob\(jobId: string\)[\s\S]*logisticsJobs\(\)\.doc\(jobId\)\.get\(\)/);
  assert.match(store, /export async function getDeliveryLoad\(loadId: string\)[\s\S]*deliveryLoads\(\)\.doc\(loadId\)\.get\(\)/);
  assert.doesNotMatch(route, /const currentLoads = \(await listDeliveryLoadState\(\)\)\.loads/);
  assert.doesNotMatch(route, /body\.job \|\| \(await listDeliveryLoadState\(\)\)/);
});

test("deferred collection run search is scoped to its target date", () => {
  assert.match(route, /runs\(\)\.where\("serviceDate", "==", body\.targetServiceDate\)/);
  assert.doesNotMatch(route, /const allRunsSnap = await transaction\.get\(runs\(\)\)/);
});

test("read-budget diagnostics are opt-in", () => {
  assert.match(store, /process\.env\.LOGISTICS_READ_BUDGET === "1"/);
  assert.match(store, /\[logistics-read-budget\]/);
});

test("IndexedDB cache keys persist across sessions but isolate auth contexts", () => {
  const franco = logisticsCacheScope({ id: "authid:franco", identityKind: "person", representedOplocId: "site:main", primaryCustodianLegendId: "legend:main" });
  const laterSession = logisticsCacheScope({ id: "authid:franco", identityKind: "person", representedOplocId: "site:main", primaryCustodianLegendId: "legend:main" });
  const otherUser = logisticsCacheScope({ id: "authid:other", identityKind: "person", representedOplocId: "site:main", primaryCustodianLegendId: "legend:main" });
  const otherScope = logisticsCacheScope({ id: "authid:franco", identityKind: "operational", representedOplocId: "site:other", primaryCustodianLegendId: "legend:other" });
  assert.deepEqual(logisticsCacheKey(franco, "2026-08-31"), logisticsCacheKey(laterSession, "2026-08-31"));
  assert.notDeepEqual(logisticsCacheKey(franco, "2026-08-31"), logisticsCacheKey(otherUser, "2026-08-31"));
  assert.notDeepEqual(logisticsCacheKey(franco, "2026-08-31"), logisticsCacheKey(otherScope, "2026-08-31"));
});

test("incremental reads validate cursors and classify Firestore failures as infrastructure errors", () => {
  assert.match(route, /Number\.isSafeInteger\(after\)/);
  assert.match(route, /after < 0/);
  assert.match(route, /LOGISTICS_CHANGE_READ_UNAVAILABLE/);
  assert.match(api, /safeDiagnostic/);
  assert.match(api, /cause: safeDiagnostic\(e\.cause\)/);
  assert.match(indexes, /"serviceDate"[\s\S]*"sequence"/);
});
