import assert from "node:assert/strict";
import { test } from "node:test";
import { dishReferenceDigest, resolveWeekDishReferences, type DishReferenceReaders } from "../lib/dish-reference-resolver";
import type { MenuActor } from "../lib/auth";
import type { MenuItem } from "../lib/domain";
import type { HistoricalDishReferenceManifest, HistoricalDishSuccessor } from "../lib/dish-reference-contract";
import type { RollingSnapshot } from "../lib/rolling-menu-types";
import { catalogueEntriesForItems } from "../lib/catalogue";

const hash = "a".repeat(64);
test("reference digests canonicalise JSON order while retaining timestamp values", () => {
  assert.equal(dishReferenceDigest({ b: 2, a: 1 }), dishReferenceDigest({ a: 1, b: 2 }));
  assert.equal(dishReferenceDigest({ at: new Date("2026-11-01T20:00:00Z") }), dishReferenceDigest({ at: "2026-11-01T20:00:00.000Z" }));
  assert.notEqual(dishReferenceDigest({ at: new Date("2026-11-01T20:00:00Z") }), dishReferenceDigest({ at: new Date("2026-11-01T21:00:00Z") }));
});
const actor: MenuActor = { uid: "fixture-reviewer", email: "fixture@example.invalid", role: "reviewer", allOplocs: true, oplocIds: [] };
const dish = (id: string, archived = false): MenuItem => ({ canonicalId: id, displayName: `Current ${id}`, sourceName: id, category: "Salad", subcategory: "Veg", reviewStatus: archived ? "archived" : "unreviewed", weekId: "catalogue", dayId: "", revision: 1, sourceReference: { workbook: "fixture", sheet: "fixture" }, allergenEvidence: [], mayContainReviewed: false, audit: [] });
const snapshot = (ids: Array<string | undefined> = ["dish:old"]): RollingSnapshot => ({ week: { id: "week:fixture", weekCommencing: "2026-11-02", weekEnding: "2026-11-08", version: 7, status: "published", dayIds: ["day:1"], entryIds: ids.map((_, i) => `entry:${i}`), sourceFiles: [], audit: [] }, days: [{ id: "day:1", date: "2026-11-02", dayName: "Monday", entryIds: ids.map((_, i) => `entry:${i}`) }], entries: ids.map((id, i) => ({ id: `entry:${i}`, dayId: "day:1", date: "2026-11-02", itemId: id, itemLabel: `Saved historical label ${i}`, slot: "SALAD 2", portions: 13, allocations: [{ destinationId: "oploc:visible", destinationLabel: "Fixture", quantity: 13 }], allergens: {}, audit: [] })) });
function readers(items: MenuItem[] = []) {
  const calls: string[][] = [];
  const value: DishReferenceReaders = { source: async () => ({ revision: 4, hash }), items: async ids => { calls.push(ids); return items.filter(item => ids.includes(item.canonicalId)); }, archiveManifest: async () => undefined, archived: async () => ({}), successors: async () => ({}) };
  return { value, calls };
}
function history() {
  const archive = { id: "dish:old", archivedAt: "2026-11-01T20:00:00Z", data: { kind: "dish", record: dish("dish:old") } };
  const mapping: HistoricalDishSuccessor = { fromId: "dish:old", toId: "dish:survivor", decisionId: "review:verified", decidedBy: "fixture-reviewer", decidedAt: "2026-11-01T20:00:00Z" };
  const dishHashes = { "dish:old": dishReferenceDigest(archive) };
  const mappingHashes = { "dish:old": dishReferenceDigest(mapping) };
  const manifest: HistoricalDishReferenceManifest = { schemaVersion: 1, archiveId: "fixture-cutover", catalogueRevision: 4, catalogueSourceHash: hash, dishHashes, mappingHashes, archiveDigest: dishReferenceDigest(dishHashes), mappingVersion: 1, mappingDigest: dishReferenceDigest(mappingHashes) };
  const r = readers([dish("dish:survivor")]);
  r.value.source = async () => ({ revision: 4, hash, historical: { archiveId: manifest.archiveId, archiveDigest: manifest.archiveDigest, mappingVersion: 1, mappingDigest: manifest.mappingDigest } });
  r.value.archiveManifest = async () => manifest;
  r.value.archived = async () => ({ "dish:old": archive });
  r.value.successors = async () => ({ "dish:old": mapping });
  return { ...r, archive, mapping, manifest };
}

test("active metadata reflects current classification without changing any saved placement", async () => {
  for (const status of ["published", "draft", "imported"] as const) {
    const original = snapshot(); original.week.status = status;
    const before = structuredClone(original);
    const r = readers([dish("dish:old")]);
    const result = await resolveWeekDishReferences(original, actor, r.value);
    assert.deepEqual(original, before);
    assert.equal(result.dishReferences.weekId, original.week.id);
    assert.equal(result.dishReferences.weekVersion, 7);
    assert.deepEqual(result.dishReferences.byEntryId["entry:0"].classification, { category: "Salad", subcategory: "Veg" });
    assert.equal(result.dishReferences.byEntryId["entry:0"].state, "active");
    assert.deepEqual(r.calls, [["dish:old"]]);
  }
});

test("archived live record remains historical and names/aliases cannot invent a merged successor", async () => {
  const old = dish("dish:old", true); old.sourceAliases = ["Current dish:survivor"];
  const result = await resolveWeekDishReferences(snapshot(), actor, readers([old]).value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "archived");
  assert.equal(result.dishReferences.byEntryId["entry:0"].successor, undefined);
  assert.deepEqual(catalogueEntriesForItems(result.items), []);
});

test("legacy merge audit without a durable verified target stays unresolved", async () => {
  const old = dish("dish:old", true);
  old.audit.push({ action: "automatically-merged-into-canonical-dish", at: "2026-10-01T10:00:00Z", by: "fixture-reviewer" });
  const result = await resolveWeekDishReferences(snapshot(), actor, readers([old]).value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved");
  assert.equal(result.dishReferences.byEntryId["entry:0"].reason, "mapping_unverified");
  assert.equal(result.dishReferences.byEntryId["entry:0"].successor, undefined);
});

test("verified immutable old record and successor map resolve exactly one active survivor", async () => {
  const h = history(); const original = snapshot(); const before = structuredClone(original);
  const result = await resolveWeekDishReferences(original, actor, h.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "merged");
  assert.deepEqual(result.dishReferences.byEntryId["entry:0"].successor, { id: "dish:survivor", name: "Current dish:survivor", category: "Salad", subcategory: "Veg" });
  assert.deepEqual(h.calls, [["dish:old"], ["dish:survivor"]]);
  assert.deepEqual(original, before);
});

test("missing, unavailable and tampered archive evidence preserves an unresolved saved row", async () => {
  for (const failure of ["missing", "unavailable", "tampered-map", "tampered-archive", "lower-revision", "same-revision-other-hash", "descriptor-mismatch", "bad-index"] as const) {
    const h = history();
    if (failure === "missing") h.value.archiveManifest = async () => undefined;
    if (failure === "unavailable") h.value.archived = async () => { throw new Error("fixture unavailable"); };
    if (failure === "tampered-map") h.value.successors = async () => ({ "dish:old": { ...h.mapping, toId: "dish:other" } });
    if (failure === "tampered-archive") h.archive.data.record.displayName = "Changed after hash";
    if (failure === "lower-revision") h.manifest.catalogueRevision = 5; // archive sealed after the live revision (4): rollback/odd state
    if (failure === "same-revision-other-hash") h.manifest.catalogueSourceHash = "d".repeat(64);
    if (failure === "descriptor-mismatch") h.value.source = async () => ({ revision: 4, hash, historical: { archiveId: h.manifest.archiveId, archiveDigest: "e".repeat(64), mappingVersion: 1, mappingDigest: h.manifest.mappingDigest } });
    if (failure === "bad-index") h.manifest.mappingHashes["dish:old"] = "b".repeat(64);
    const original = snapshot(); const before = structuredClone(original);
    const result = await resolveWeekDishReferences(original, actor, h.value);
    assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved", failure);
    assert.equal(result.dishReferences.byEntryId["entry:0"].successor, undefined, failure);
    assert.deepEqual(original, before);
  }
});

test("mapping to an inactive/missing target, a chain/cycle or still-active old ID never merges", async () => {
  for (const failure of ["archived-target", "missing-target", "chain", "active-old"] as const) {
    const h = history();
    if (failure === "archived-target") h.value.items = async ids => [dish("dish:survivor", true)].filter(item => ids.includes(item.canonicalId));
    if (failure === "missing-target") h.value.items = async () => [];
    if (failure === "active-old") h.value.items = async ids => [dish("dish:old"), dish("dish:survivor")].filter(item => ids.includes(item.canonicalId));
    if (failure === "chain") { h.manifest.mappingHashes["dish:survivor"] = "c".repeat(64); h.manifest.mappingDigest = dishReferenceDigest(h.manifest.mappingHashes); }
    const result = await resolveWeekDishReferences(snapshot(), actor, h.value);
    assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved", failure);
    assert.equal(result.dishReferences.byEntryId["entry:0"].successor, undefined);
  }
});

test("unknown IDs retain no fabricated identity; invalid and blank IDs do not cause catalogue reads", async () => {
  const r = readers(); const result = await resolveWeekDishReferences(snapshot(["dish:missing", undefined, "bad/id"]), actor, r.value);
  assert.deepEqual(r.calls, [["dish:missing"]]);
  assert.equal(result.dishReferences.byEntryId["entry:0"].reason, "not_found");
  assert.equal(result.dishReferences.byEntryId["entry:1"].reason, "missing_id");
  assert.equal(result.dishReferences.byEntryId["entry:2"].reason, "integrity_failed");
  const empty = readers(); await resolveWeekDishReferences(snapshot([undefined]), actor, empty.value); assert.deepEqual(empty.calls, []);
});

test("OPLOC-scoped actors cannot read or receive another site's dish metadata", async () => {
  const s = snapshot(["dish:visible", "dish:hidden", "dish:visible"]);
  s.entries[1].allocations[0].destinationId = "oploc:hidden";
  s.entries.push({ ...s.entries[1], id: "entry:blank", itemId: "dish:blank", itemLabel: " " });
  const r = readers([dish("dish:visible"), dish("dish:hidden")]);
  const result = await resolveWeekDishReferences(s, { ...actor, allOplocs: false, oplocIds: ["oploc:visible"] }, r.value);
  assert.deepEqual(r.calls, [["dish:visible"]]);
  assert.deepEqual(Object.keys(result.dishReferences.byEntryId), ["entry:0", "entry:2"]);
  assert.deepEqual(result.items.map(item => item.canonicalId), ["dish:visible"]);
});

test("missing actor is denied before any reader runs", async () => {
  const r = readers(); let read = false; r.value.source = async () => { read = true; return {}; };
  await assert.rejects(resolveWeekDishReferences(snapshot(), undefined as never, r.value), (error: any) => error.status === 401);
  assert.equal(read, false);
  assert.deepEqual(r.calls, []);
});

test("catalogue revision changing mid-read fails metadata closed without changing saved evidence", async () => {
  const r = readers([dish("dish:old")]); let calls = 0; r.value.source = async () => ({ revision: ++calls === 1 ? 4 : 5, hash });
  const result = await resolveWeekDishReferences(snapshot(), actor, r.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].reason, "integrity_failed");
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved");
});

test("missing source provenance preserves saved rows without inventing a catalogue revision", async () => {
  const r = readers([dish("dish:old")]); r.value.source = async () => { throw new Error("manifest unavailable"); };
  const result = await resolveWeekDishReferences(snapshot(), actor, r.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved");
  assert.deepEqual(result.dishReferences.byEntryId["entry:0"].provenance, {});
  assert.equal(result.items[0].canonicalId, "dish:old");
});

test("blank week has no reference reads and unexpected catalogue records cannot escape the request", async () => {
  const r = readers(); let sourceReads = 0; r.value.source = async () => { sourceReads++; return { revision: 4, hash }; };
  assert.deepEqual((await resolveWeekDishReferences(snapshot([]), actor, r.value)).dishReferences.byEntryId, {});
  assert.equal(sourceReads, 0);
  r.value.items = async () => [dish("dish:old"), dish("dish:unrequested")];
  const result = await resolveWeekDishReferences(snapshot(), actor, r.value);
  assert.deepEqual(result.items.map(item => item.canonicalId), ["dish:old"]);
});

test("verified archive-only old ID stays visible as archived without requiring active membership", async () => {
  const h = history(); h.manifest.mappingHashes = {}; h.manifest.mappingDigest = dishReferenceDigest({});
  const result = await resolveWeekDishReferences(snapshot(), actor, h.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "archived");
  assert.equal(result.dishReferences.byEntryId["entry:0"].classification, undefined);
});

test("routine catalogue edits after cutover keep archived, merged and active references resolving", async () => {
  const h = history(); // sealed at revision 4
  const newHash = "f".repeat(64);
  const archivedOnly = dish("dish:retired", true);
  const archive2 = { id: "dish:retired", archivedAt: "2026-11-01T20:00:00Z", data: { kind: "dish", record: archivedOnly } };
  h.manifest.dishHashes["dish:retired"] = dishReferenceDigest(archive2);
  h.manifest.archiveDigest = dishReferenceDigest(h.manifest.dishHashes);
  const descriptor = { archiveId: h.manifest.archiveId, archiveDigest: h.manifest.archiveDigest, mappingVersion: 1, mappingDigest: h.manifest.mappingDigest };
  h.value.source = async () => ({ revision: 7, hash: newHash, historical: descriptor }); // cutover R=4, edited to R+3 with a new sourceHash
  h.value.archived = async (_archiveId, ids) => Object.fromEntries([["dish:old", h.archive], ["dish:retired", archive2]].filter(([id]) => ids.includes(id as string)));
  h.value.items = async ids => [dish("dish:survivor"), dish("dish:live"), archivedOnly].filter(item => ids.includes(item.canonicalId));
  const result = await resolveWeekDishReferences(snapshot(["dish:old", "dish:retired", "dish:live"]), actor, h.value);
  const refs = result.dishReferences.byEntryId;
  assert.equal(refs["entry:0"].state, "merged");
  assert.equal(refs["entry:0"].successor?.id, "dish:survivor");
  assert.equal(refs["entry:1"].state, "archived");
  assert.equal(refs["entry:2"].state, "active");
  assert.equal(refs["entry:0"].provenance.catalogueRevision, 7);
  assert.equal(refs["entry:0"].provenance.catalogueSourceHash, newHash);
  assert.equal(refs["entry:0"].provenance.archiveDigest, h.manifest.archiveDigest);
});

test("a tampered archive digest still fails closed after the live revision has advanced", async () => {
  const h = history();
  h.value.source = async () => ({ revision: 7, hash: "f".repeat(64), historical: { archiveId: h.manifest.archiveId, archiveDigest: h.manifest.archiveDigest, mappingVersion: 1, mappingDigest: h.manifest.mappingDigest } });
  h.manifest.dishHashes["dish:old"] = "b".repeat(64); // index no longer matches archiveDigest
  const result = await resolveWeekDishReferences(snapshot(), actor, h.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved");
  assert.equal(result.dishReferences.byEntryId["entry:0"].reason, "integrity_failed");
});

test("a live revision lower than the archive-bound cutover revision fails closed", async () => {
  const h = history();
  h.manifest.catalogueRevision = 9;
  h.value.source = async () => ({ revision: 8, hash: "f".repeat(64), historical: { archiveId: h.manifest.archiveId, archiveDigest: h.manifest.archiveDigest, mappingVersion: 1, mappingDigest: h.manifest.mappingDigest } });
  const result = await resolveWeekDishReferences(snapshot(), actor, h.value);
  assert.equal(result.dishReferences.byEntryId["entry:0"].state, "unresolved");
  assert.equal(result.dishReferences.byEntryId["entry:0"].reason, "integrity_failed");
  assert.equal(result.dishReferences.byEntryId["entry:0"].successor, undefined);
});
