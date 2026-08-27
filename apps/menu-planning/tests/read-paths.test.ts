import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("rolling-menu read path resolves catalogue data without reconciliation writes", () => {
  const source = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  const getBody = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /syncRollingEntries|attachCanonicalDishIds|saveSnapshot|updateRollingState/);
  assert.match(getBody, /listWeekSummaries/);
  assert.match(getBody, /getWeekSnapshot/);
  assert.match(getBody, /Promise\.all\(\[listCatalogueEntriesForIds\(.*publicationState/);
});

test("catalogue and rolling-menu GET handlers return structured JSON errors", () => {
  const catalogue = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  const rolling = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(catalogue, /NextResponse\.json\(\{ error: \{ message:/);
  assert.match(rolling, /NextResponse\.json\(\{ error: \{ message:/);
});

test("hosted rolling reads use targeted week and publication paths", () => {
  const repository = readFileSync(new URL("../lib/firestore-operational-store.ts", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../app/planner-data.ts", import.meta.url), "utf8");
  assert.match(repository, /listWeekSummaries\(\)/);
  assert.match(repository, /getWeekSnapshot\(weekId: string\)/);
  assert.match(repository, /where\("sourceWeekId", "==", weekId\)/);
  assert.match(planner, /weekCache/);
  assert.match(planner, /summariesOnly=true/);
  assert.match(planner, /neighbor/);
});
