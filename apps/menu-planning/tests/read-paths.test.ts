import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { catalogueErrorMessage, catalogueManifestFromResponse, catalogueManifestMatches, resolveCachedCatalogueEntry } from "../lib/menu-catalogue-cache";

test("rolling-menu read path resolves catalogue data without reconciliation writes", () => {
  const source = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  const getBody = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /syncRollingEntries|attachCanonicalDishIds|saveSnapshot|updateRollingState/);
  assert.match(getBody, /listWeekSummaries/);
  assert.match(getBody, /getWeekHead/);
  assert.match(getBody, /getWeekSnapshot/);
  assert.match(getBody, /Promise\.all\(\[listCatalogueEntriesForIds\(.*publicationState/);
  assert.doesNotMatch(getBody, /listCatalogueEntries\(\)/);
});

test("Delivered-In OPLOC lookups reuse the authorized service-arrangements response", () => {
  const source = readFileSync(new URL("../lib/oploc-authority.ts", import.meta.url), "utf8");
  const deliveredInReader = source.slice(source.indexOf("export async function readDeliveredInOplocs"));
  assert.match(deliveredInReader, /\/api\/service-arrangements/);
  assert.doesNotMatch(deliveredInReader, /\/api\/oplocs/);
  assert.match(deliveredInReader, /arrangementData\.oplocs/);
});

test("portion readiness reuses successful checks for the same week version and day", () => {
  const source = readFileSync(new URL("../app/portion-planner.tsx", import.meta.url), "utf8");
  assert.match(source, /loadPublicationReadiness/);
  assert.match(source, /snapshot\.week\.version/);
  assert.match(source, /selectedDayId/);
  assert.match(source, /loadCatalogue: false/);
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
  assert.match(repository, /collection\(MENU_PLANNING_COLLECTIONS\.weeks\)\.limit\(100\)\.get/);
  assert.match(repository, /getWeekHead\(weekId: string\)/);
  assert.match(repository, /collection\(MENU_PLANNING_COLLECTIONS\.weeks\)\.doc\(weekId\)\.get/);
  assert.match(repository, /getWeekSnapshot\(weekId: string\)/);
  assert.match(repository, /where\("sourceWeekId", "==", weekId\)/);
  assert.match(planner, /weekCache/);
  assert.match(planner, /summariesOnly=true&weekId=/);
  assert.doesNotMatch(planner, /fetch\("\/api\/rolling-menu\?summariesOnly=true"/);
  assert.match(planner, /neighbor/);
  assert.match(planner, /fetchWeek\(neighbor\.id, true\)/);
  assert.match(planner, /snapshotOnly=true/);
  assert.match(planner, /getCachedWeek|putCachedWeek/);
  assert.match(planner, /getCachedWeekSelection/);
  assert.match(planner, /putCachedWeekSelection/);
  assert.match(planner, /history\.pushState/);
  assert.match(planner, /popstate/);
  assert.doesNotMatch(planner, /router\.push/);
  const weekCache = readFileSync(new URL("../lib/menu-week-cache.ts", import.meta.url), "utf8");
  assert.match(weekCache, /fika-menu-planning/);
  assert.match(weekCache, /selectedWeek/);
  assert.match(weekCache, /identity/);
  assert.match(weekCache, /const databaseVersion = 3/);
  assert.match(weekCache, /oldVersion < databaseVersion/);
  assert.match(weekCache, /objectStore\(storeName\)\.clear/);
});

test("known-neighbour prefetch requests a targeted snapshot without week summaries", () => {
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(route, /snapshotOnly/);
  assert.match(route, /snapshotOnly && requestedWeek \? \[\] :/);
  assert.match(route, /snapshotOnly && requestedWeek \? await getWeekHead/);
});

test("rolling resolution never guesses catalogue identity from a label", () => {
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(route, /entry\.itemId \? resolvedCatalogue\.find\(item => item\.id === entry\.itemId\)/);
  assert.doesNotMatch(route, /item\.name\.trim\(\)\.toLocaleLowerCase\(\) === entry\.itemLabel/);
  assert.match(route, /missing-stable-catalogue-id/);
  assert.match(route, /catalogue-item-not-found/);
  assert.doesNotMatch(route, /await listCatalogueEntries\(\)/);
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

test("manifest and Allergen Checker paths avoid unnecessary full catalogue reads", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  const manifest = readFileSync(new URL("../lib/catalogue-manifest.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  const checker = readFileSync(new URL("../app/allergen-checker.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /__manifest__/);
  assert.match(manifest, /fikaMenuPlanningCatalogueManifests/);
  assert.match(manifest, /collection\(collectionName\)\.doc\("catalogue"\)\.get/);
  assert.match(api, /searchParams\.get\("manifest"\)/);
  assert.match(api, /getCatalogueManifest/);
  assert.match(cache, /manifestFetcher/);
  assert.match(cache, /catalogueManifestMatches/);
  assert.match(checker, /useRollingData\(\{ loadCatalogue: false \}\)/);
  assert.match(checker, /entry\.allergens/);
  assert.match(checker, /function displayAllergenState\(/);
  assert.match(checker, /key === "no_key_allergens"\) return namedAllergenPresent \? "clear" : "contains"/);
  assert.match(checker, /disabled=\{key === "no_key_allergens"\}/);
  assert.match(checker, /Record the planned allergen information for CPU Production/);
  assert.match(checker, /CPU performs the final independent safety check/);
  assert.match(checker, /command\("update-entry"/);
});

test("compiled publication snapshots use a separate targeted read model", () => {
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../lib/firestore-operational-store.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/rolling-menu/publications/[publicationId]/snapshot/route.ts", import.meta.url), "utf8");
  assert.match(publication, /buildCompiledPublicationSnapshot/);
  assert.match(publication, /contentHash\(base\)/);
  assert.match(publication, /MAX_COMPILED_SNAPSHOT_BYTES/);
  assert.match(repository, /fikaMenuPlanningPublishedSnapshots/);
  assert.match(repository, /getPublishedSnapshot\(publicationId/);
  assert.match(route, /getCompiledPublicationSnapshot/);
  assert.match(route, /params: Promise/);
});

test("normal rolling and publication lookups use bounded repository primitives", () => {
  const rolling = readFileSync(new URL("../lib/rolling-menu.ts", import.meta.url), "utf8");
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  const listWeeksBody = rolling.slice(rolling.indexOf("export async function listWeeks"), rolling.indexOf("export async function listAllEntries"));
  const getWeekBody = rolling.slice(rolling.indexOf("export async function getWeek"), rolling.indexOf("export async function addOneOffDestination"));
  assert.match(listWeeksBody, /listWeekSummaries/);
  assert.doesNotMatch(listWeeksBody, /readRollingState/);
  assert.match(getWeekBody, /getWeekSnapshot/);
  assert.match(getWeekBody, /listWeeks/);
  assert.doesNotMatch(getWeekBody, /readRollingState/);
  assert.match(publication, /listPublicationState<StoredPublications>\(limit\)/);
  assert.match(publication, /getPublicationById<MenuPublication>\(publicationId\)/);
  assert.match(publication, /getPublishedSnapshot<CompiledPublishedWeekSnapshot>\(publicationId, version\)/);
  assert.match(publication, /sourceWeekId: publication\.sourceWeekId, includeEvents: false/);
  assert.match(publication, /Explicit historical audit\/repair read/);
});

test("catalogue manifest comparison is version based", () => {
  assert.equal(catalogueManifestMatches({ schemaVersion: 1, catalogueVersion: 42 }, { schemaVersion: 1, catalogueVersion: 42 }), true);
  assert.equal(catalogueManifestMatches({ schemaVersion: 1, catalogueVersion: 42 }, { schemaVersion: 1, catalogueVersion: 43 }), false);
  assert.equal(catalogueManifestMatches(undefined, { schemaVersion: 1, catalogueVersion: 42 }), false);
  assert.equal(catalogueManifestMatches({ schemaVersion: 1, catalogueVersion: 42, dishCount: 2 }, { schemaVersion: 1, catalogueVersion: 42, dishCount: 3 }), false);
  assert.equal(catalogueManifestMatches({ schemaVersion: 1, catalogueVersion: 42, contentHash: "a" }, { schemaVersion: 1, catalogueVersion: 42, contentHash: "b" }), false);
});

test("catalogue cache preserves warm records while manifest revalidates in the background", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /findLatestCache/);
  assert.match(cache, /return cached\.entries/);
  assert.match(cache, /void revalidateCatalogue/);
  assert.match(cache, /if \(catalogueManifestMatches\(cached\.manifest, manifest\)\)/);
  assert.match(cache, /await refreshCatalogue\(fetcher, namespace, onUpdate\)/);
  assert.match(cache, /Do not replace the last-known-good manifest/);
  assert.doesNotMatch(cache, /return \[\]/);
});

test("catalogue cache keeps package version distinct from IndexedDB schema version", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /packageVersion\?: number/);
  assert.match(cache, /indexedDbVersion = 2/);
  assert.match(cache, /packageVersion: manifest\?\.catalogueVersion/);
});

test("stable catalogue resolution never falls back to display names", () => {
  const entries = [{ id: "dish:one", name: "Same name" }, { id: "dish:two", name: "Same name" }];
  assert.equal(resolveCachedCatalogueEntry(entries, "dish:two")?.id, "dish:two");
  assert.equal(resolveCachedCatalogueEntry(entries, "Same name"), undefined);
  assert.equal(resolveCachedCatalogueEntry(entries), undefined);
});

test("rolling-menu enrichment remains a bounded server-side stable-ID read", () => {
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(route, /listCatalogueEntriesForIds\(snapshot\.entries\.map\(entry => entry\.itemId \|\| ""\)\)/);
  assert.match(route, /item\.id === entry\.itemId/);
  assert.match(route, /resolveAllergenSnapshot/);
  assert.doesNotMatch(route, /indexedDB|CLIENT_CACHE/);
});

test("catalogue package publication reuses live usage classification", () => {
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../lib/catalogue.ts", import.meta.url), "utf8");
  assert.match(repository, /catalogueUsagesFor\(item\)/);
  assert.match(catalogue, /catalogueUsagesFor\(item\)/);
});

test("catalogue responses retain package content hash for cache validation", () => {
  assert.equal(catalogueManifestFromResponse({ schemaVersion: 1, catalogueVersion: 3, package: { contentHash: "hash-v3" } }).contentHash, "hash-v3");
});

test("catalogue cache keeps cached records on manifest and refresh failures", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /manifest-fallback/);
  assert.match(cache, /onUpdate\?\.\(result\.entries\)/);
  assert.match(cache, /void refreshCatalogue\(fetcher, cacheNamespace, onUpdate\)\.catch/);
});

test("structured catalogue errors are rendered as useful text", () => {
  assert.equal(catalogueErrorMessage({ message: "Manifest unavailable." }, "fallback"), "Manifest unavailable.");
  assert.equal(catalogueErrorMessage({ code: "CATALOGUE_DOWN" }, "fallback"), "fallback");
  assert.notEqual(catalogueErrorMessage({ message: "Manifest unavailable." }, "fallback"), "[object Object]");
  const workspace = readFileSync(new URL("../app/catalogue-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /catalogueErrorMessage\(body\.error/);
});

test("cold catalogue loads populate IndexedDB without broad warm reads", () => {
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /return refreshCatalogue\(fetcher, namespace, onUpdate, onStateChange\)/);
  assert.match(cache, /await putCachedCatalogue\(result\.entries, namespace/);
  const workspace = readFileSync(new URL("../app/catalogue-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /loadCachedCatalogue\(fetchCatalogue/);
});

test("normal warm Dish Library path does not perform a broad catalogue Firestore read", () => {
  const workspace = readFileSync(new URL("../app/catalogue-workspace.tsx", import.meta.url), "utf8");
  const cache = readFileSync(new URL("../lib/menu-catalogue-cache.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workspace, /firestore|listCatalogueEntries/);
  assert.match(cache, /getAll\(IDBKeyRange\.bound/);
  assert.match(cache, /manifestFetcher/);
});

test("catalogue mutations publish an immutable package after canonical persistence", () => {
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repository, /__manifest__/);
  assert.match(repository, /publishCataloguePackage/);
  assert.match(readFileSync(new URL("../../../packages/server-shared/src/read-package.ts", import.meta.url), "utf8"), /putImmutable/);
});
