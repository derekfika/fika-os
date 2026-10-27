import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DeliveryStop } from "../lib/types";
import { dispatchBlockers, hasScheduledTime } from "../app/mobile/dispatch-readiness";

const stop = (overrides: Partial<DeliveryStop> = {}) => ({ canonicalId: "s", status: "planned", ...overrides }) as unknown as DeliveryStop;
const ready = { hasStops: true, deliveries: [stop({ loaded: true })], openIssues: 0, unscheduled: 0 };

test("dispatch is unblocked only when every delivery is loaded, nothing is open and every stop is timed", () => {
  assert.deepEqual(dispatchBlockers(ready), []);
});

test("each server-side departure rule produces a driver-facing reason", () => {
  assert.deepEqual(dispatchBlockers({ ...ready, hasStops: false, deliveries: [] }), ["This run has no stops to load."]);
  assert.deepEqual(dispatchBlockers({ ...ready, deliveries: [stop({ loaded: true }), stop(), stop()] }), ["2 deliveries still to load"]);
  assert.deepEqual(dispatchBlockers({ ...ready, openIssues: 1 }), ["Resolve 1 open issue before departure"]);
  assert.deepEqual(dispatchBlockers({ ...ready, unscheduled: 2 }), ["2 stops have no scheduled time"]);
});

test("scheduled time uses the same fields the server checks", () => {
  assert.equal(hasScheduledTime(stop({ plannedWindow: { startTime: "09:00" } } as Partial<DeliveryStop>)), true);
  assert.equal(hasScheduledTime(stop({ plannedArrivalTime: "09:00" })), true);
  assert.equal(hasScheduledTime(stop({ requiredTime: "09:00" })), true);
  assert.equal(hasScheduledTime(stop()), false);
});

test("load check disables dispatch while blockers remain and keeps the server pending label", () => {
  const source = readFileSync(new URL("../app/mobile/run-load-check.tsx", import.meta.url), "utf8");
  assert.match(source, /disabled=\{pending \|\| !ready\}/);
  assert.match(source, /\{pending \? pendingLabel : "Dispatch vehicle"\}/);
});

test("stop detail keeps lane-level actions and the existing server action names", () => {
  const workflow = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
  for (const action of ["mark-stop-loaded", "arrive-stop", "complete-stop", "undo-completion", "resolve-issue", "defer-collection"]) assert.match(workflow, new RegExp(`"${action}"`));
  assert.match(workflow, /onIssue=\{\(lane\) =>/);
});
