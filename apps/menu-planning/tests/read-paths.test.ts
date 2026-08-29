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
  assert.match(planner, /summariesOnly/);
  assert.match(planner, /neighbor/);
  assert.match(planner, /getCachedWeek|putCachedWeek/);
  assert.match(planner, /history\.pushState/);
  assert.match(planner, /popstate/);
  assert.doesNotMatch(planner, /router\.push/);
  assert.match(readFileSync(new URL("../lib/menu-week-cache.ts", import.meta.url), "utf8"), /fika-menu-planning/);
});

test("hosted mutation and publication paths expose bounded transaction scopes", () => {
  const repository = readFileSync(new URL("../lib/firestore-operational-store.ts", import.meta.url), "utf8");
  const rolling = readFileSync(new URL("../lib/rolling-menu.ts", import.meta.url), "utf8");
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  assert.match(repository, /scope\.weekId/);
  assert.match(repository, /scope\.sourceWeekId/);
  assert.match(repository, /includeEvents !== false/);
  assert.match(rolling, /sourceWeekId: "__none__", includeEvents: false/);
  assert.match(publication, /sourceWeekId: weekId, includeEvents: false/);
  assert.match(publication, /updateMenuPlanningEvent\(claimed\.eventId/);
  assert.match(publication, /claimNextMenuPlanningEvent\(claimId, at\)/);
  assert.match(repository, /where\("delivery\.status", "in", \["pending", "failed"\]\)/);
});

test("catalogue read budget has explicit bounded cache invalidation", () => {
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /HOSTED_CATALOGUE_TTL_MS/);
  assert.match(repository, /invalidateHostedCatalogueCache/);
  assert.match(repository, /recordMenuPlanningReadBudget/);
});

test("known catalogue IDs use document lookups rather than an ID query scan", () => {
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../lib/catalogue.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  assert.match(repository, /db\.getAll\(\.\.\./);
  assert.match(repository, /\.doc\(cleanId\)\.get\(\)/);
  assert.doesNotMatch(repository, /where\("id", "in"/);
  assert.match(catalogue, /getCatalogueEntryById/);
  assert.match(api, /searchParams\.get\("id"\)/);
});

test("client catalogue cache is identity-scoped, bounded, stale-revalidating and disposable", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../app/catalogue-workspace.tsx", import.meta.url), "utf8");
  assert.match(cache, /fika-menu-planning/);
  assert.match(cache, /menuCatalogue/);
  assert.match(cache, /cacheMetadata/);
  assert.match(cache, /window\.location\.origin/);
  assert.match(cache, /fika-menu-identity/);
  assert.match(cache, /IDBKeyRange\.bound/);
  assert.match(cache, /10 \* 60_000/);
  assert.match(cache, /refreshInFlight = new Map/);
  assert.match(cache, /invalidateCatalogueCache/);
  assert.match(workspace, /loadCachedCatalogue/);
  assert.doesNotMatch(workspace, /fetch\(`\/api\/catalogue\?\$\{params\}/);
});
