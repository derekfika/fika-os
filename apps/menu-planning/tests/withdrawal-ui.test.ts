import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Week Planner recovers an older current publication before rendering withdrawal", async () => {
  const source = await readFile(new URL("../app/rolling-menu-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /currentPublicationId/);
  assert.match(source, /publications\?publicationId=/);
  assert.match(source, /publication\.publicationId === currentPublicationId/);
  assert.match(source, /hasPublishedWeek && currentPublication/);
});

test("Portion Planner withdraws the week and replaces cache-first state with an authoritative refresh", async () => {
  const planner = await readFile(new URL("../app/portion-planner.tsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../app/planner-data.ts", import.meta.url), "utf8");
  assert.match(planner, /<h3>Withdraw week<\/h3>/);
  assert.doesNotMatch(planner, /window\.location\.reload\(\)/);
  assert.match(planner, /const refreshed = await refreshWeek\(snapshot\.week\.id\)/);
  assert.match(data, /const refreshWeek = useCallback\(async \(weekId: string\)/);
  assert.match(data, /const body = await fetchWeek\(weekId\)/);
  assert.match(data, /weekCache\.set\(weekId, value\)/);
  assert.match(data, /setPublicationState\(value\.publicationState\)/);
  assert.match(data, /await persistCachedWeek\(value, generation\)/);
});
