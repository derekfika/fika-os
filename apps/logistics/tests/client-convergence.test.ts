import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planner = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/logistics/route.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

test("desktop and driver use coalesced visible-tab head checks before full projection reads", () => {
  for (const source of [planner, mobile]) {
    assert.match(source, /syncCheckInFlight\.current/);
    assert.match(source, /document\.visibilityState/);
    assert.match(source, /syncHead=1&serviceDate=/);
    assert.match(source, /30_000/);
  }
  assert.match(planner, /Number\(head\.sequence\) !== projectionSequence\.current/);
  assert.match(mobile, /projectionSequence\.current !== Number\(body\?\.sequence \|\| 0\)/);
});

test("successful desktop mutations converge both day and week state", () => {
  assert.match(planner, /await requireSuccessfulResponse\(response, "Action failed\."\)[\s\S]*await Promise\.all\(\[load\(\), loadWeek\(\)\]\)/);
  assert.match(planner, /if \(result\.changed\) await Promise\.all\(\[load\(true\), loadWeek\(\)\]\)/);
  assert.match(route, /appendLogisticsChange[\s\S]*rebuildLogisticsProjection/);
});

test("date restoration cannot load a different day before URL state settles", () => {
  assert.match(planner, /requestedDate && requestedDate !== date[\s\S]*setDate\(requestedDate\)[\s\S]*setWeekCommencing\(mondayOf\(requestedDate\)\)[\s\S]*return;/);
});

test("successful recovery clears stale errors and refreshes the tracked sequence", () => {
  for (const source of [planner, mobile]) {
    assert.match(source, /projectionSequence\.current = projection\.lastChangeSequence/);
    assert.match(source, /setError\(""\)/);
  }
});

test("server diagnostics retain request, operation, date, entity, and revision context", () => {
  assert.match(api, /requestId: safeRequestId, \.\.\.context/);
  assert.match(route, /operation: body\.action/);
  assert.match(route, /serviceDate: body\.serviceDate/);
  assert.match(route, /projectionSequence: body\.expectedRunVersion/);
  assert.match(route, /entityId: body\.runId/);
});
