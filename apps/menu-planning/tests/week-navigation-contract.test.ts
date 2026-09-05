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

test("staging reset preserves reusable planning-source history unless hard reset is explicit", async () => {
  const reset = await readFile(new URL("../../../tools/uat/reset-staging.mjs", import.meta.url), "utf8");
  assert.match(reset, /fikaMenuPlanningWeeks/);
  assert.match(reset, /const hardResetPlanningHistory = args\.has\("--hard-reset-planning-history"\)/);
  assert.match(reset, /HARD RESET ONLY/);
  assert.match(reset, /hardResetPlanningHistory && !confirmReset/);
  assert.match(reset, /if \(hardResetPlanningHistory\) await db\.recursiveDelete\(db\.collection\("fikaMenuPlanningWeeks"\)\)/);
  const deleteBlock = reset.slice(reset.indexOf("const DELETE_COLLECTIONS"), reset.indexOf("const CLEAR_DERIVED_STORAGE"));
  assert.doesNotMatch(deleteBlock, /fikaMenuPlanningWeeks/);
  const preserveBlock = reset.slice(reset.indexOf("const PRESERVE_COLLECTIONS"), reset.indexOf("const DELETE_COLLECTIONS"));
  assert.match(preserveBlock, /fikaMenuPlanningWeeks/);
  assert.doesNotMatch(reset, /recursiveDelete\(doc\.ref\)/);
});
