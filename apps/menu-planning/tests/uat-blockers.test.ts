import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPublishedDay } from "../lib/menu-publication";
import { emptyWeek, validateWeek } from "../lib/rolling-menu";
import { syntheticCatalogueCandidate } from "../lib/synthetic-catalogue";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("unused menu rows are valid and excluded from publication", () => {
  const snapshot = emptyWeek("2098-01-05");
  const day = snapshot.days[0];
  snapshot.entries = [{ id: "entry:unused", dayId: day.id, date: day.date, slot: "SALAD 1", itemLabel: "Held dish", portions: 0, allocations: [], allergens: {}, audit: [] }];
  assert.deepEqual(validateWeek(snapshot, { governedOplocIds: new Set(["oploc:valid"]), requireCanonicalDishId: false }), []);
  assert.deepEqual(buildPublishedDay(snapshot, day).entries, []);
});

test("publication derives portions from positive allocations and omits zero lines", () => {
  const snapshot = emptyWeek("2098-01-12");
  const day = snapshot.days[0];
  snapshot.entries = [{ id: "entry:active", dayId: day.id, date: day.date, slot: "HOT MEAT", itemLabel: "Active dish", itemId: "dish:active", portions: 999, allocations: [{ destinationId: "oploc:valid", destinationLabel: "Valid OPLOC", quantity: 7 }, { destinationId: "oploc:zero", destinationLabel: "Zero OPLOC", quantity: 0 }], allergens: {}, audit: [] }];
  assert.equal(validateWeek(snapshot, { governedOplocIds: new Set(["oploc:valid", "oploc:zero"]), requireCanonicalDishId: false }).length, 0);
  const published = buildPublishedDay(snapshot, day).entries[0];
  assert.equal(published.portions, 7);
  assert.deepEqual(published.allocations.map(allocation => allocation.destinationId), ["oploc:valid"]);
});

test("catalogue pollution detection requires provenance evidence", () => {
  assert.equal(syntheticCatalogueCandidate({ canonicalId: "catalogue:1", displayName: "Matrix Dish", sourceReference: { workbook: "Menu Planning", sheet: "Local dish creation" }, audit: [], allergenEvidence: [] } as never), undefined);
  assert.equal(syntheticCatalogueCandidate({ canonicalId: "catalogue:2", displayName: "Durable Test Dish", sourceReference: { workbook: "fixture:uat", sheet: "test" }, audit: [], allergenEvidence: [] } as never)?.id, "catalogue:2");
});

test("UAT blocker contracts remain wired end to end", () => {
  const catalogueRoute = read("../app/api/catalogue/route.ts");
  const rollingRoute = read("../app/api/rolling-menu/route.ts");
  const portionPlanner = read("../app/portion-planner.tsx");
  const publication = read("../lib/menu-publication.ts");
  assert.match(catalogueRoute, /await request\.json\(\)/);
  assert.match(catalogueRoute, /NextResponse\.json\(\{ error: \{ message/);
  assert.match(rollingRoute, /action === "batch-update-entries"/);
  const batchAction = rollingRoute.slice(rollingRoute.indexOf('action === "batch-update-entries"'), rollingRoute.indexOf('action === "create-entry"'));
  assert.doesNotMatch(batchAction, /reconcileCatalogueFromRollingEntries|syncRollingEntries/);
  assert.match(portionPlanner, /command\("batch-update-entries"/);
  assert.match(portionPlanner, /expectedWeekVersion/);
  assert.match(portionPlanner, /localStorage/);
  assert.match(publication, /Number\.isFinite\(allocation\.quantity\) && allocation\.quantity > 0/);
});
