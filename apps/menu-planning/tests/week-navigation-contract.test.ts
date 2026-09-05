import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("week planner navigation is independent of persisted week summaries", async () => {
  const route = await readFile(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/rolling-menu-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /planningWeekFromQuery/);
  assert.match(route, /emptyWeek\(requestedWeekCommencing \|\| planningWeekFromQuery\(undefined\)\)/);
  assert.match(workspace, /navigateWeek/);
  assert.match(workspace, /rolling-week:\$\{addDays\(current, direction \* 7\)\}/);
  assert.match(workspace, /params\.set\("weekId", body\.snapshot\.week\.id\)/);
});

test("staging reset keeps reusable planning-source history by targeted status", async () => {
  const reset = await readFile(new URL("../../../tools/uat/reset-staging.mjs", import.meta.url), "utf8");
  assert.match(reset, /fikaMenuPlanningWeeks/);
  assert.match(reset, /PLANNING_HISTORY_PRESERVE_STATUSES/);
  assert.match(reset, /PLANNING_HISTORY_DELETE_STATUSES/);
  assert.match(reset, /recursiveDelete\(doc\.ref\)/);
  assert.match(reset, /MIXED \/ TARGETED/);
  const deleteBlock = reset.slice(reset.indexOf("const DELETE_COLLECTIONS"), reset.indexOf("const PLANNING_HISTORY"));
  assert.doesNotMatch(deleteBlock, /fikaMenuPlanningWeeks/);
});
