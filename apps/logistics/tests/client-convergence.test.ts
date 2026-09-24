import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mayRequestPassiveRefresh, PASSIVE_REFRESH_INTERVAL_MS } from "../lib/passive-refresh";

const planner = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/logistics/route.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

test("desktop uses a throttled visible-tab head check before full projection reads", () => {
  assert.match(planner, /syncCheckInFlight\.current/);
  assert.match(planner, /document\.visibilityState/);
  assert.match(planner, /syncHead=1&serviceDate=/);
  assert.match(planner, /requestPassiveRefresh\("visibility"\)/);
  assert.match(planner, /requestPassiveRefresh\("broadcast"\)/);
  assert.match(planner, /PASSIVE_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(planner, /30_000/);
  assert.match(planner, /projectionSequence\.current !== undefined && Number\(head\.sequence\) === projectionSequence\.current[\s\S]*return;/);
  assert.match(mobile, /projectionSequence\.current !== Number\(body\?\.sequence \|\| 0\)/);
});

test("desktop passive refresh policy blocks chatter inside the 15-minute window", () => {
  assert.equal(PASSIVE_REFRESH_INTERVAL_MS, 15 * 60_000);
  const base = { now: 15 * 60_000, visible: true, requestsBlocked: false, inFlight: false };
  assert.equal(mayRequestPassiveRefresh({ ...base, lastAttemptAt: undefined }), true);
  assert.equal(mayRequestPassiveRefresh({ ...base, lastAttemptAt: 0 }), true);
  assert.equal(mayRequestPassiveRefresh({ ...base, lastAttemptAt: 0, now: PASSIVE_REFRESH_INTERVAL_MS - 1 }), false);
  assert.equal(mayRequestPassiveRefresh({ ...base, lastAttemptAt: 0, now: PASSIVE_REFRESH_INTERVAL_MS }), true);
  assert.equal(mayRequestPassiveRefresh({ ...base, visible: false }), false);
  assert.equal(mayRequestPassiveRefresh({ ...base, requestsBlocked: true }), false);
  assert.equal(mayRequestPassiveRefresh({ ...base, inFlight: true }), false);
});

test("mobile retains its tighter active-driver convergence cadence", () => {
  assert.match(mobile, /window\.setInterval[\s\S]*30_000/);
  assert.match(mobile, /visibilitychange/);
  assert.match(mobile, /BroadcastChannel\("fika-logistics-live"\)/);
});

test("successful desktop mutations converge both day and week state", () => {
  assert.match(planner, /await requireSuccessfulResponse\(response, "Action failed\."\)[\s\S]*await Promise\.all\(\[load\(\), loadWeek\(\)\]\)/);
  assert.match(planner, /if \(result\.changed\) \{[\s\S]*const refreshed = await load\(true\);[\s\S]*if \(refreshed\.ok\) await loadWeek\(\)/);
  assert.match(route, /appendLogisticsChange[\s\S]*rebuildLogisticsProjection/);
});

test("date restoration cannot load a different day before URL state settles", () => {
  assert.match(planner, /requestedDate && requestedDate !== date[\s\S]*setDate\(requestedDate\)[\s\S]*setWeekCommencing\(mondayOf\(requestedDate\)\)[\s\S]*return;/);
});

test("the approved create-run workflow has a reachable control", () => {
  assert.match(planner, /onClick=\{\(\) => props\.setShowRunCreate\(true\)\}>＋ New run/);
  assert.match(planner, /action: "create-run"/);
});

test("successful recovery clears stale errors and refreshes the tracked sequence", () => {
  for (const source of [planner, mobile]) {
    assert.match(source, /projectionSequence\.current = projection\.lastChangeSequence/);
    assert.match(source, /setError\(""\)/);
  }
});

test("passive failures preserve usable data and use compact degraded status", () => {
  assert.match(planner, /recordPassiveError/);
  assert.match(planner, /setPassiveSyncError\("Sync unavailable · showing last updated data"\)/);
  assert.match(planner, /mode === "passive"[\s\S]*recordPassiveError/);
  assert.match(planner, /passiveSyncError && <div className="passive-sync-warning"/);
  assert.match(planner, /setProjectionData\(undefined\)/);
});

test("manual refresh and successful mutations bypass passive throttling", () => {
  assert.match(planner, /onClick=\{\(\) => void props\.load\(true\)/);
  assert.match(planner, /await Promise\.all\(\[load\(\), loadWeek\(\)\]\)/);
});

test("first-load provisioning is gated on successful authoritative convergence", () => {
  assert.match(planner, /type LoadResult = \{ ok: true/);
  assert.match(planner, /const result = await load\(\);[\s\S]*if \(result\.ok && !requestsBlocked\.current\) await ensureVehicleDayRuns\(date\)/);
  assert.match(planner, /if \(result\.changed\) \{[\s\S]*const refreshed = await load\(true\);[\s\S]*if \(refreshed\.ok\) await loadWeek\(\)/);
  assert.match(planner, /loadInFlight\.current/);
  assert.match(planner, /bootstrapInFlight\.current/);
});

test("fresh projection loads use the fresh sequence baseline and re-check the head", () => {
  assert.match(planner, /freshHeadResponse = await fetchPlannerGet\(`\/api\/logistics\?syncHead=1&serviceDate=\$\{date\}`/);
  assert.match(planner, /drainIncrementalPages\(projection\.lastChangeSequence/);
  assert.doesNotMatch(planner, /drainIncrementalPages\(cached\?\.lastChangeSequence/);
});

test("server diagnostics retain request, operation, date, entity, and revision context", () => {
  assert.match(api, /requestId: safeRequestId,[\s\S]*\.\.\.context/);
  assert.match(route, /operation: body\.action/);
  assert.match(route, /serviceDate: body\.serviceDate/);
  assert.match(route, /projectionSequence: body\.expectedRunVersion/);
  assert.match(route, /entityId: body\.runId/);
});
