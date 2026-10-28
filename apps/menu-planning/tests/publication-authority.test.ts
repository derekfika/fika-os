import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCompiledPublicationSnapshot, buildPublishedDay, publicationDayBlockers, publishedDayMatrixHtml, referencedCanonicalDishIds } from "../lib/menu-publication";
import { decodeWeeklyPublicationPacket, encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";
import type { MenuItem } from "../lib/domain";
import type { RollingDay, RollingSnapshot } from "../lib/rolling-menu-types";

const day: RollingDay = { id: "week:day:0", date: "2026-09-14", dayName: "Monday", entryIds: ["entry:1"] };
const baseSnapshot = (overrides: Record<string, unknown> = {}): RollingSnapshot => ({
  week: { id: "week:authority", weekCommencing: "2026-09-14", weekEnding: "2026-09-20", status: "draft", version: 1, dayIds: [day.id], entryIds: ["entry:1"], sourceFiles: [], audit: [] },
  days: [day],
  entries: [{ id: "entry:1", dayId: day.id, date: day.date, slot: "SOUP", itemId: "dish:authority", itemLabel: "Authority dish", portions: 10, allocations: [{ destinationId: "oploc:1", destinationLabel: "Site", quantity: 10 }], allergens: {}, audit: [], ...overrides }],
});
const dish = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  canonicalId: "dish:authority", sourceName: "Authoritative source", displayName: "Authority dish", category: "soup", weekId: "catalogue", dayId: "", sourceReference: { workbook: "authoritative", sheet: "catalogue" }, revision: 1, reviewStatus: "approved", allergenEvidence: [{ allergen: "sesame", value: "contains", source: "governed review" }], mayContainReviewed: true, audit: [], ...overrides,
});
const strict = { requireAuthoritativeCatalogue: true } as const;

test("publication resolves zero-allocation dish identities without generating production entries", () => {
  const snapshot = baseSnapshot({ portions: 0, allocations: [] });
  const ids = referencedCanonicalDishIds(snapshot);
  assert.deepEqual(ids, ["dish:authority"]);
  assert.deepEqual(publicationDayBlockers(snapshot, day.id, new Set(["oploc:1"]), new Set(ids)), []);
  assert.deepEqual(buildPublishedDay(snapshot, day, [dish()], strict).entries, []);
  assert.match(publicationDayBlockers(snapshot, day.id, new Set(["oploc:1"]), new Set()).join(" "), /does not exist or is archived/);
  assert.equal(snapshot.entries[0].portions, 0);
  assert.deepEqual(snapshot.entries[0].allocations, []);
});

test("canonical publication lookup is bounded by named rows, stable IDs and optional day scope", () => {
  const snapshot = baseSnapshot({ portions: 0, allocations: [] });
  snapshot.entries.push({ ...snapshot.entries[0], id: "duplicate" }, { ...snapshot.entries[0], id: "blank", itemLabel: " ", itemId: "dish:blank" }, { ...snapshot.entries[0], id: "other-day", dayId: "other-day", itemId: "dish:other" });
  assert.deepEqual(referencedCanonicalDishIds(snapshot), ["dish:authority", "dish:other"]);
  assert.deepEqual(referencedCanonicalDishIds(snapshot, day.id), ["dish:authority"]);
});

test("publication binds to the supplied authoritative dish instead of bundled catalogue data", () => {
  const source = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /canonical-menu-items\.json/);
  assert.match(source, /listCanonicalMenuItemsByIds/);
  const published = buildPublishedDay(baseSnapshot(), day, [dish({ allergenEvidence: [{ allergen: "sesame", value: "free_from", source: "Firestore review" }] })], strict);
  assert.equal(published.entries[0].canonicalDishId, "dish:authority");
  assert.equal(published.entries[0].allergens.sesame, "clear");
});

test("missing authoritative dish fails publication closed without all-clear output", () => {
  assert.throws(() => buildPublishedDay(baseSnapshot(), day, [], strict), (error: any) => error.status === 422 && error.code === "PUBLICATION_ALLERGEN_UNRESOLVED" && /authoritative catalogue/.test(error.message));
});

test("unknown evidence, incomplete may-contain review, and invalidated entry review remain visible but do not block publication", () => {
  const unknown = buildPublishedDay(baseSnapshot(), day, [dish({ allergenEvidence: [{ allergen: "sesame", value: "unknown", source: "unreviewed" }] })], strict);
  assert.equal(unknown.entries[0].allergenEvidenceStatus, "conflicting");
  assert.equal(unknown.entries[0].allergens.no_key_allergens, "unrecorded");
  const incomplete = buildPublishedDay(baseSnapshot(), day, [dish({ mayContainReviewed: false })], strict);
  assert.equal(incomplete.entries[0].allergenEvidenceStatus, "unreviewed");
  const invalidated = buildPublishedDay(baseSnapshot({ allergenReviewInvalidated: true }), day, [dish()], strict);
  assert.equal(invalidated.entries[0].allergenEvidenceStatus, "unreviewed");
});

test("missing allergen evidence never serializes as an all-clear matrix", () => {
  const published = buildPublishedDay(baseSnapshot(), day, [dish({ allergenEvidence: [], mayContainReviewed: false })], strict);
  assert.equal(published.entries[0].allergenEvidenceStatus, "unreviewed");
  assert.equal(Object.keys(published.entries[0].allergens).length, 1);
  assert.equal(published.entries[0].allergens.no_key_allergens, "unrecorded");
  const html = publishedDayMatrixHtml({ ...published, version: 1 });
  assert.match(html, /class="unrecorded"/);
  assert.match(html, />UR<\/td>/);
});

test("valid governed evidence publishes the exact expected allergen snapshot", () => {
  const published = buildPublishedDay(baseSnapshot(), day, [dish({ allergenEvidence: [{ allergen: "sesame", value: "contains", source: "Firestore review" }, { allergen: "milk", value: "may_contain", source: "Firestore review" }] })], strict);
  assert.equal(published.entries[0].allergens.sesame, "contains");
  assert.equal(published.entries[0].allergens.milk, "may_contain");
});

test("Dessert dishes keep their governed slot and identity through publication and CPU packet encoding", () => {
  const dessertDay = { ...day, entryIds: ["entry:dessert"] };
  const snapshot = baseSnapshot();
  snapshot.week.entryIds = ["entry:dessert"];
  snapshot.entries = [{ id: "entry:dessert", dayId: dessertDay.id, date: dessertDay.date, slot: "DESSERT 1", itemId: "dish:dessert", itemLabel: "mini pavlova", portions: 12, allocations: [{ destinationId: "oploc:1", destinationLabel: "Site", quantity: 12 }], allergens: {}, audit: [] }];
  const dessert = dish({ canonicalId: "dish:dessert", sourceName: "mini pavlova", displayName: "mini pavlova", category: "Dessert" });
  const built = buildPublishedDay(snapshot, dessertDay, [dessert], strict);
  assert.equal(built.entries[0].slot, "DESSERT 1");
  assert.equal(built.entries[0].canonicalDishId, "dish:dessert");
  assert.equal(built.entries[0].dishName, "mini pavlova");

  const compiled = buildCompiledPublicationSnapshot({
    publicationId: "menu-publication:dessert",
    sourceWeekId: snapshot.week.id,
    weekCommencing: snapshot.week.weekCommencing,
    weekEnding: snapshot.week.weekEnding,
    publicationVersion: 1,
    publicationStatus: "published",
    days: [{ publicationDayId: "published-dessert-day", sourceDayId: dessertDay.id, date: dessertDay.date, dayName: dessertDay.dayName, version: 1, status: "published", contentHash: built.contentHash, publishedAt: "2026-09-14T12:00:00.000Z", publishedBy: "test", entries: built.entries }],
    audit: [],
  }, snapshot.week.version);
  const decoded = decodeWeeklyPublicationPacket(encodeWeeklyPublicationPacket(compiled));
  assert.equal(decoded.days[0].entries[0].slot, "DESSERT 1");
  assert.equal(decoded.days[0].entries[0].canonicalDishId, "dish:dessert");
});

test("ordinary publication has no catalogue reconciliation side effect", () => {
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(publication, /syncRollingEntries|reconcileCatalogueFromRollingEntries/);
  assert.doesNotMatch(route.slice(route.indexOf('if (action === "publish")'), route.indexOf("return NextResponse.json(\n      { error: { message: \"Unknown rolling menu command.\" }")), /reconcileCatalogueFromRollingEntries|syncRollingEntries/);
});
