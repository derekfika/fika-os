import test from "node:test";
import assert from "node:assert/strict";
import { draftStorageKey, editWeek, isWeekDirty, parseRecoveredDraft, reconcileWeek, weekChanges } from "../lib/week-draft";
import type { RollingSnapshot } from "../lib/rolling-menu-types";
import { applyRollingEntryPatch } from "../lib/rolling-command";

export const fixture = (): RollingSnapshot => ({
  week: { id: "rolling-week:2099-01-05", weekCommencing: "2099-01-05", weekEnding: "2099-01-11", version: 96, status: "draft", dayIds: ["day:1"], entryIds: ["entry:1"], templateSlots: ["GARNISH 1", "SOUP"], sourceFiles: [], audit: [] },
  days: [{ id: "day:1", date: "2099-01-05", dayName: "Monday", entryIds: ["entry:1"] }],
  entries: [{ id: "entry:1", dayId: "day:1", date: "2099-01-05", slot: "GARNISH 1", itemId: "dish:almonds", itemLabel: "Toasted Almonds", portions: 12, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 12 }], allergens: { nuts: "contains" }, audit: [] }],
});
test("twenty edits are immediate, retain immutable baseline, identity, portions and allocations", () => {
  const base = fixture(); const before = JSON.stringify(base); let draft = structuredClone(base);
  for (let i = 0; i < 20; i++) draft = editWeek(draft, "update-entry", { entryId: "entry:1", patch: { itemLabel: `Draft name ${i}` } });
  assert.equal(JSON.stringify(base), before); assert.equal(draft.week.version, 96); assert.equal(draft.entries[0].itemLabel, "Draft name 19");
  assert.equal(draft.entries[0].itemId, base.entries[0].itemId); assert.deepEqual(draft.entries[0].allocations, base.entries[0].allocations); assert.equal(draft.entries[0].portions, 12);
  assert.equal(isWeekDirty(base, draft), true); assert.equal(weekChanges(base, draft).updates.length, 1); assert.deepEqual(draft.week.audit, []);
});
test("Core Salad is a local draft placement field, persists through save diff and can be toggled off", () => {
  const base = fixture(); base.entries[0].slot = "SALAD 1";
  const draft = editWeek(base, "update-entry", { entryId: "entry:1", patch: { isCoreSalad: true } });
  assert.equal(isWeekDirty(base, draft), true);
  assert.equal(weekChanges(base, draft).updates[0].patch.isCoreSalad, true);
  assert.equal(base.entries[0].isCoreSalad, undefined);
  const cleared = editWeek(draft, "update-entry", { entryId: "entry:1", patch: { isCoreSalad: false } });
  assert.equal(isWeekDirty(base, cleared), false);
});
test("changing Core presentation metadata preserves explicit allergen review and No Key evidence", () => {
  const entry = fixture().entries[0]; entry.slot = "SALAD 1";
  entry.noKeyDeclaration = { declared: true, declaredBy: "actor:reviewer", declaredAt: "2099-01-01T10:00:00Z" };
  entry.allergenReview = { status: "confirmed", semantics: 3, confirmedBy: "actor:reviewer", confirmedAt: "2099-01-01T10:00:00Z", statement: "recipe-ingredients-allergens-verified", inputFingerprint: "fingerprint" };
  const review = structuredClone(entry.allergenReview), noKey = structuredClone(entry.noKeyDeclaration);
  applyRollingEntryPatch(entry, { isCoreSalad: true });
  assert.deepEqual(entry.allergenReview, review);
  assert.deepEqual(entry.noKeyDeclaration, noKey);
});
test("clear and restore original content returns to an unchanged draft; review evidence is never sent", () => {
  const base = fixture(); let draft = editWeek(base, "update-entry", { entryId: "entry:1", patch: { itemId: "", itemLabel: "", portions: 0, allocations: [] } });
  assert.equal(draft.entries[0].itemLabel, ""); assert.deepEqual(draft.entries[0].allergens, {});
  draft = editWeek(draft, "update-entry", { entryId: "entry:1", patch: base.entries[0] });
  assert.equal(isWeekDirty(base, draft), false); assert.deepEqual(weekChanges(base, draft).updates, []);
});
test("recovery is scoped by identity, environment and week, with original baseline retained", () => {
  const base = fixture(), draft = editWeek(base, "update-entry", { entryId: "entry:1", patch: { itemLabel: "Mine" } });
  const stored = JSON.stringify({ schema: 1, identity: "person:1", environment: "https://stage", base, draft, savedAt: 1 });
  assert.equal(parseRecoveredDraft(stored, "person:1", "https://stage", base.week.id)?.draft.entries[0].itemLabel, "Mine");
  for (const args of [["person:2", "https://stage", base.week.id], ["person:1", "https://prod", base.week.id], ["person:1", "https://stage", "other-week"]]) assert.equal(parseRecoveredDraft(stored, args[0], args[1], args[2]), undefined);
  assert.notEqual(draftStorageKey("person:1", "stage", base.week.id), draftStorageKey("person:2", "stage", base.week.id));
  assert.equal(parseRecoveredDraft("broken", "person:1", "https://stage", base.week.id), undefined);
});
test("a full 95-dish draft serializes and reloads intact from browser recovery data", () => {
  const base = fixture();
  base.entries = Array.from({ length: 95 }, (_, index) => ({ ...base.entries[0], id: `entry:${index}`, itemId: `dish:${index}`, itemLabel: `Dish ${index}` }));
  base.week.entryIds = base.entries.map(entry => entry.id);
  base.days[0].entryIds = base.entries.map(entry => entry.id);
  const draft = editWeek(base, "update-entry", { entryId: "entry:94", patch: { itemLabel: "Friday copied dish" } });
  const stored = JSON.stringify({ schema: 1, identity: "person:1", environment: "https://stage", base, draft, savedAt: 2 });
  const recovered = parseRecoveredDraft(stored, "person:1", "https://stage", base.week.id)!;
  assert.equal(recovered.base.entries.length, 95);
  assert.equal(recovered.draft.entries.length, 95);
  assert.equal(recovered.draft.entries.find(entry => entry.id === "entry:94")?.itemLabel, "Friday copied dish");
  assert.equal(recovered.base.entries.find(entry => entry.id === "entry:94")?.itemLabel, "Dish 94");
});
test("two editors combine independent fields and expose competing edits without overwriting either", () => {
  const base = fixture(); const mine = editWeek(base, "update-entry", { entryId: "entry:1", patch: { itemLabel: "My name" } });
  const remote = structuredClone(base); remote.week.version++; remote.entries[0].portions = 15;
  let result = reconcileWeek(base, mine, remote); assert.equal(result.conflicts.length, 0); assert.equal(result.merged.entries[0].itemLabel, "My name"); assert.equal(result.merged.entries[0].portions, 15);
  remote.entries[0].itemLabel = "Their name"; result = reconcileWeek(base, mine, remote);
  assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].local, "My name"); assert.equal(result.conflicts[0].remote, "Their name"); assert.equal(mine.entries[0].itemLabel, "My name");
});
test("a successful save rebase keeps edits made while the request is in flight", () => {
  const base = fixture(); const sent = editWeek(base, "update-entry", { entryId: "entry:1", patch: { itemLabel: "Sent name" } });
  const editedWhileSaving = editWeek(sent, "update-entry", { entryId: "entry:1", patch: { itemLabel: "Later name" } });
  const saved = structuredClone(sent); saved.week.version++;
  const { merged, conflicts } = reconcileWeek(sent, editedWhileSaving, saved);
  assert.equal(conflicts.length, 0); assert.equal(merged.week.version, 97); assert.equal(merged.entries[0].itemLabel, "Later name"); assert.equal(isWeekDirty(saved, merged), true);
});
test("published days remain locked and a new conflicting slot requires explicit review", () => {
  const base = fixture(); const locked = structuredClone(base); locked.week.dayStatuses = { "day:1": "published" };
  assert.throws(() => editWeek(locked, "update-entry", { entryId: "entry:1", patch: { itemLabel: "No" } }), /locked/);
  const local = editWeek(base, "create-entry", { id: `${base.week.id}:entry:local`, dayId: "day:1", slot: "SOUP", itemId: "dish:soup", itemLabel: "My soup" });
  const remote = editWeek(base, "create-entry", { id: `${base.week.id}:entry:remote`, dayId: "day:1", slot: "SOUP", itemId: "dish:other", itemLabel: "Their soup" });
  assert.equal(reconcileWeek(base, local, remote).conflicts[0].field, "create"); assert.equal(local.entries[1].itemLabel, "My soup");
});
test("superseded publication evidence and archived structural changes stay locked", () => {
  const base = fixture();
  for (const status of ["published", "superseded"] as const) {
    const locked = structuredClone(base); locked.week.dayStatuses = { "day:1": status };
    assert.throws(() => editWeek(locked, "update-entry", { entryId: "entry:1", patch: { itemLabel: "Unsafe edit" } }), /locked/);
    assert.throws(() => editWeek(locked, "create-entry", { id: `${base.week.id}:entry:new-${status}`, dayId: "day:1", slot: "SOUP", itemId: "dish:soup", itemLabel: "Soup" }), /locked/);
  }
  const archived = structuredClone(base); archived.week.status = "archived";
  assert.throws(() => editWeek(archived, "add-menu-slot", { category: "Soup" }), /locked/);
  assert.throws(() => editWeek(archived, "remove-menu-slot", { slot: "GARNISH 1" }), /locked/);
});
test("published working draft editing is explicit and cannot change shared row structure", () => {
  const base = fixture(); base.week.status = "published"; base.week.dayStatuses = { "day:1": "published" };
  assert.throws(() => editWeek(base, "update-entry", { entryId: "entry:1", patch: { portions: 15 } }), /locked/);
  const draft = editWeek(base, "update-entry", { entryId: "entry:1", patch: { portions: 15, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 15 }] } }, { workingDraft: true });
  assert.equal(draft.entries[0].portions, 15); assert.equal(base.entries[0].portions, 12); assert.equal(draft.week.status, "published");
  assert.throws(() => editWeek(base, "create-entry", { dayId: "day:1", slot: "SOUP", itemId: "dish:soup", itemLabel: "Soup" }), /locked/);
});
test("clearing a newly placed dish produces no save, and newly created allocations stay in the draft changes", () => {
  const base = fixture(); const created = editWeek(base, "create-entry", { id: `${base.week.id}:entry:soup`, dayId: "day:1", slot: "SOUP", itemId: "dish:soup", itemLabel: "Soup" });
  const allocated = editWeek(created, "batch-update-entries", { updates: [{ entryId: created.entries[1].id, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 10 }] }] });
  assert.equal(weekChanges(base, allocated).creates[0].portions, 10); assert.equal(weekChanges(base, allocated).creates[0].allocations[0].quantity, 10);
  const cleared = editWeek(created, "update-entry", { entryId: created.entries[1].id, patch: { itemId: "", itemLabel: "", portions: 0, allocations: [] } });
  assert.equal(isWeekDirty(base, cleared), false);
});
