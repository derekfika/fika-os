import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPublishedDay, publishedDayMatrixHtml } from "../lib/menu-publication";
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

test("ordinary publication has no catalogue reconciliation side effect", () => {
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(publication, /syncRollingEntries|reconcileCatalogueFromRollingEntries/);
  assert.doesNotMatch(route.slice(route.indexOf('if (action === "publish")'), route.indexOf("return NextResponse.json(\n      { error: { message: \"Unknown rolling menu command.\" }")), /reconcileCatalogueFromRollingEntries|syncRollingEntries/);
});
