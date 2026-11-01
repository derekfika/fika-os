import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dishReferenceForEntry, selectableDishIds, type DishReference, type DishReferences } from "../lib/week-planner-layout";
import { parseDishReferences } from "../app/planner-data";

const provenance = { catalogueRevision: 12, catalogueSourceHash: "catalogue-hash" };
const reference = (overrides: Partial<DishReference> = {}): DishReference => ({ entryId: "entry-1", requestedId: "dish-old", state: "unresolved", provenance, ...overrides });
const references = (value: DishReference, weekId = "week-1", weekVersion = 4): DishReferences => ({ schemaVersion: "menu-planning.dish-references.v1", weekId, weekVersion, byEntryId: { [value.entryId]: value } });
const entry = (overrides: Partial<{ id: string; itemId?: string; itemLabel: string; slot: string; portions: number }> = {}) => ({ id: "entry-1", itemId: "dish-old", itemLabel: "Saved historic label", slot: "SALAD 1", portions: 18, ...overrides });
const noticeFor = (saved: ReturnType<typeof entry>, value: DishReferences) => dishReferenceForEntry(saved, value, { id: "week-1", version: 4 });

test("active category and explicit salad subtype changes produce a reclassification notice without changing the saved entry", () => {
  const saved = entry();
  const before = structuredClone(saved);
  const categoryNotice = noticeFor(saved, references(reference({ state: "active", classification: { category: "Soup" } })));
  assert.equal(categoryNotice?.state, "reclassified");
  assert.match(categoryNotice!.message, /Current Dish Library classification: Soup/);
  assert.match(categoryNotice!.message, /remains in SALAD 1/);

  const subtypeNotice = noticeFor(saved, references(reference({ state: "active", classification: { category: "Salad", subcategory: "Slaw" } })));
  assert.equal(subtypeNotice?.state, "reclassified");
  assert.deepEqual(saved, before);
});

test("matching active classification does not tint the saved placement", () => {
  assert.equal(noticeFor(entry(), references(reference({ state: "active", classification: { category: "Salad", subcategory: "Leaf" } }))), undefined);
});

test("verified archived references remain historical and are excluded from new picker choices", () => {
  const archived = reference({ state: "archived", provenance: { ...provenance, archiveId: "cutover-1", archiveDigest: "archive-digest" } });
  const saved = entry();
  const before = structuredClone(saved);
  const notice = noticeFor(saved, references(archived));
  assert.equal(notice?.state, "archived");
  assert.match(notice!.message, /unavailable for new selections/);
  assert.deepEqual(selectableDishIds([{ id: "dish-old" }, { id: "dish-current" }], references(archived), [entry()]), [{ id: "dish-current" }]);
  assert.deepEqual(selectableDishIds([{ id: "different-id" }], references(reference({ state: "archived", requestedId: "different-id", provenance: { ...provenance, archiveId: "cutover-1", archiveDigest: "archive-digest" } })), [entry()]), [{ id: "different-id" }]);
  assert.deepEqual(saved, before);
});

test("a merged notice names only the explicit verified successor mapping", () => {
  const merged = reference({ state: "merged", successor: { id: "dish-v2", name: "Verified V2 dish", category: "Salad" }, provenance: { ...provenance, mappingVersion: 3, mappingDigest: "mapping-digest" } });
  const notice = noticeFor(entry(), references(merged));
  assert.equal(notice?.state, "merged");
  assert.match(notice!.message, /Verified V2 dish/);
  assert.deepEqual(selectableDishIds([{ id: "dish-old" }, { id: "dish-v2" }], references(merged), [entry()]), [{ id: "dish-v2" }]);
  assert.equal(noticeFor(entry(), references(reference({ state: "merged", successor: undefined })))?.state, "unresolved");
});

test("unresolved, stale, and mismatched-ID metadata never invents a successor or changes placement", () => {
  const saved = entry();
  const before = structuredClone(saved);
  const unresolved = noticeFor(saved, references(reference({ state: "unresolved", reason: "mapping_unverified", successor: { id: "dish-guessed", name: "Do not show", category: "Salad" } })));
  assert.equal(unresolved?.state, "unresolved");
  assert.doesNotMatch(unresolved!.message, /Do not show|dish-guessed/);
  assert.equal(dishReferenceForEntry(saved, references(reference(), "another-week"), { id: "week-1", version: 4 }), undefined);
  assert.equal(noticeFor(saved, references(reference({ requestedId: "different-id" }))), undefined);
  assert.equal(noticeFor(saved, references(reference({ state: "active", requestedId: undefined, classification: { category: "Soup" } }))), undefined);
  assert.equal(noticeFor(saved, references(reference({ state: "archived", requestedId: undefined }))), undefined);
  assert.equal(noticeFor(saved, references(reference({ state: "merged", requestedId: undefined, successor: { id: "dish-v2", name: "Verified V2 dish", category: "Salad" }, provenance: { ...provenance, mappingVersion: 1, mappingDigest: "mapping" } }))), undefined);
  assert.equal(noticeFor(entry({ itemId: undefined }), references(reference({ requestedId: undefined, reason: "missing_id" })))?.state, "unresolved");
  assert.equal(noticeFor(entry({ itemId: "dish-old" }), references(reference({ requestedId: undefined, reason: "missing_id" }))), undefined);
  assert.deepEqual(saved, before);
});

test("DTO adapter binds metadata to exact week/version and degrades unverified archive or merge records to unresolved", () => {
  const raw = {
    schemaVersion: "menu-planning.dish-references.v1",
    weekId: "week-1",
    weekVersion: 4,
    byEntryId: {
      archived: { ...reference({ entryId: "archived", state: "archived" }) },
      merged: { ...reference({ entryId: "merged", state: "merged", successor: { id: "dish-old", name: "Same saved dish", category: "Salad" }, provenance: { ...provenance, mappingVersion: 1, mappingDigest: "mapping" } }) },
      validMerged: { ...reference({ entryId: "validMerged", state: "merged", requestedId: "dish-old", successor: { id: "dish-v2", name: "Verified V2 dish", category: "Salad" }, provenance: { ...provenance, mappingVersion: 1, mappingDigest: "mapping" } }) },
    unresolvedWithoutManifest: { entryId: "unresolvedWithoutManifest", requestedId: "dish-old", state: "unresolved", reason: "not_found", provenance: {} },
    },
  };
  const parsed = parseDishReferences(raw, "week-1", 4)!;
  assert.equal(parsed.byEntryId.archived.state, "unresolved");
  assert.equal(parsed.byEntryId.archived.reason, "archive_unavailable");
  assert.equal(parsed.byEntryId.merged.state, "unresolved");
  assert.equal(parsed.byEntryId.merged.reason, "mapping_unverified");
  assert.equal(parsed.byEntryId.validMerged.state, "merged");
  assert.equal(parsed.byEntryId.unresolvedWithoutManifest.state, "unresolved");
  assert.deepEqual(parsed.byEntryId.unresolvedWithoutManifest.provenance, {});
  assert.equal(parseDishReferences(raw, "week-1", 5), undefined);
  assert.equal(parseDishReferences(raw, "another-week", 4), undefined);
});

test("draft, published, historical and copied-style entries are display-only consumers", () => {
  for (const saved of [entry({ id: "entry-draft", itemId: "dish-old" }), entry({ id: "entry-published", itemId: "dish-old" }), entry({ id: "entry-copy", itemId: "dish-old" })]) {
    const before = structuredClone(saved);
    const notice = noticeFor(saved, references(reference({ entryId: saved.id, state: "archived", provenance: { ...provenance, archiveId: "cutover-1", archiveDigest: "archive-digest" } })));
    assert.equal(notice?.state, "archived");
    assert.deepEqual(saved, before);
  }
});

test("status tooltip is reachable by pointer, keyboard focus and touch activation without grid clipping", () => {
  const component = readFileSync(fileURLToPath(new URL("../app/week-planner.tsx", import.meta.url)), "utf8");
  const styles = readFileSync(fileURLToPath(new URL("../app/planner-stage2.css", import.meta.url)), "utf8");
  assert.match(component, /className="week-dish-reference-trigger" aria-describedby=/);
  assert.match(component, /aria-expanded=\{openDishReferenceId === entry\.id\}/);
  assert.match(component, /role="tooltip" aria-hidden="true"/);
  assert.match(styles, /\.week-dish-reference:hover \.week-dish-reference-tooltip/);
  assert.match(styles, /\.week-dish-reference:focus-within \.week-dish-reference-tooltip/);
  assert.match(styles, /\.week-dish-reference-trigger\[aria-expanded="true"\]/);
  assert.match(styles, /\.week-dish-reference-tooltip \{ display: none; max-width: 100%;/);
  assert.doesNotMatch(styles.slice(styles.indexOf(".week-dish-reference-tooltip {"), styles.indexOf(".week-dish-reference-tooltip {" ) + 350), /position:\s*(absolute|fixed)/);
});
