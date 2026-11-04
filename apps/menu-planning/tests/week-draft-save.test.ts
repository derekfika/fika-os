import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RollingSnapshot } from "../lib/rolling-menu-types";
import { editWeek, weekChanges } from "../lib/week-draft";

const directory = mkdtempSync(join(tmpdir(), "fika-week-draft-337-"));
process.chdir(directory); process.env.MENU_PLANNING_DB_PATH = join(directory, "isolated.sqlite"); process.env.MENU_PLANNING_TEST_MODE = "1";
const { applyWeekSave, saveWeekDraft } = await import("../lib/week-draft-save");
const { createCanonicalMenuItem } = await import("../lib/canonical-menu-repository");
const { emptyWeek, saveSnapshot, getWeek } = await import("../lib/rolling-menu");
const { readPublicationState } = await import("../lib/operational-store");
const allowed = new Set(["site:1"]);
const base = (): RollingSnapshot => { const snapshot = emptyWeek("2099-01-05", "fixture-actor"); const entry = { id: `${snapshot.week.id}:entry:one`, dayId: snapshot.days[0].id, date: snapshot.days[0].date, slot: "GARNISH 1", itemId: "dish:fixture", itemLabel: "Almonds", portions: 12, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 12 }], allergens: { nuts: "contains" as const }, audit: [] }; snapshot.entries.push(entry); snapshot.days[0].entryIds.push(entry.id); snapshot.week.entryIds.push(entry.id); return snapshot; };
test("atomic save preserves identities, portions and audits; replay is idempotent and reused IDs reject drift", () => {
  const source = base(); const draft = editWeek(source, "update-entry", { entryId: source.entries[0].id, patch: { itemLabel: "Toasted Almonds" } });
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-first-save", changes: weekChanges(source, draft) };
  const saved = applyWeekSave(source, request, "person:1", allowed).snapshot;
  assert.equal(saved.week.version, 2); assert.equal(saved.entries[0].id, source.entries[0].id); assert.equal(saved.entries[0].portions, 12); assert.deepEqual(saved.entries[0].allocations, source.entries[0].allocations);
  assert.equal(saved.week.audit.at(-1)?.by, "person:1"); assert.equal(saved.entries[0].audit.at(-1)?.action, "week-draft-saved");
  assert.equal(applyWeekSave(saved, request, "person:1", allowed).replayed, true); assert.equal(saved.week.version, 2);
  assert.throws(() => applyWeekSave(saved, { ...request, changes: { ...request.changes, removedSlots: [] } }, "person:1", allowed), /different changes/);
  assert.throws(() => applyWeekSave(saved, request, "person:2", allowed), /different changes/);
});
test("conflict, scope and lock failures leave the complete draft and original authority intact", () => {
  const source = base(), before = JSON.stringify(source); const draft = editWeek(source, "update-entry", { entryId: source.entries[0].id, patch: { itemLabel: "My name" } });
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-conflict", changes: weekChanges(source, draft) };
  assert.throws(() => applyWeekSave({ ...source, week: { ...source.week, version: 2 } }, request, "person:1", allowed), /changed on the server/);
  assert.throws(() => applyWeekSave(source, request, "person:1", new Set()), /scope/);
  assert.throws(() => applyWeekSave({ ...source, week: { ...source.week, status: "published" } }, request, "person:1", allowed), /locked/);
  assert.equal(JSON.stringify(source), before); assert.equal(draft.entries[0].itemLabel, "My name");
});
test("real isolated persistence: 20 local edits, one save, repeated saves, retry, reload and no publication side effects", async () => {
  const source = base(); await saveSnapshot(source); let draft = source;
  for (let i = 0; i < 20; i++) draft = editWeek(draft, "update-entry", { entryId: source.entries[0].id, patch: { itemLabel: `Label ${i}` } });
  assert.equal((await getWeek(source.week.id)).week.version, 1);
  const beforePublications = await readPublicationState();
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-persisted-1", changes: weekChanges(source, draft) };
  const first = await saveWeekDraft(request, "person:1", allowed); assert.equal(first.snapshot.week.version, 2);
  const replay = await saveWeekDraft(request, "person:1", allowed); assert.equal(replay.replayed, true); assert.equal(replay.snapshot.week.version, 2);
  const secondDraft = editWeek(first.snapshot, "update-entry", { entryId: source.entries[0].id, patch: { itemLabel: "Second save" } });
  await saveWeekDraft({ weekId: source.week.id, expectedWeekVersion: 2, requestId: "request-persisted-2", changes: weekChanges(first.snapshot, secondDraft) }, "person:1", allowed);
  const reloaded = await getWeek(source.week.id); assert.equal(reloaded.week.version, 3); assert.equal(reloaded.entries[0].itemLabel, "Second save");
  assert.deepEqual(await readPublicationState(), beforePublications);
  await assert.rejects(saveWeekDraft({ ...request, requestId: "request-other-editor" }, "person:2", allowed), /changed on the server/);
  assert.equal((await getWeek(source.week.id)).week.version, 3);
});
test("canonical creation is retained, not deleted/recreated, and forged review evidence is rejected", async () => {
  const dish = await createCanonicalMenuItem({ displayName: "Fixture soup 337", category: "Soup" }, "fixture-actor");
  const source = await getWeek("rolling-week:2099-01-05");
  const draft = editWeek(source, "create-entry", { id: `${source.week.id}:entry:new-soup`, dayId: source.days[0].id, slot: "SOUP", itemId: dish.canonicalId, itemLabel: dish.displayName });
  const request = { weekId: source.week.id, expectedWeekVersion: source.week.version, requestId: "request-create-entry", changes: weekChanges(source, draft) };
  const saved = await saveWeekDraft(request, "person:1", allowed); assert.equal(saved.snapshot.entries[0].id, source.entries[0].id); assert.equal(saved.snapshot.entries[1].itemId, dish.canonicalId); assert.deepEqual(saved.snapshot.entries[1].allergens, {});
  const forged = { ...request, changes: { ...request.changes, updates: [{ entryId: source.entries[0].id, dayId: source.days[0].id, patch: { allergenReview: { by: "fake" } } }] } };
  await assert.rejects(saveWeekDraft(forged, "person:1", allowed), /invalid entries/);
});
test("governed aliases resolve before scope checks, and invalid allocations roll back without partial writes", () => {
  const source = base(); source.entries[0].allocations[0].destinationId = "legacy:site";
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-alias-save", changes: { updates: [{ entryId: source.entries[0].id, dayId: source.days[0].id, patch: { allocations: source.entries[0].allocations } }], creates: [] } };
  const saved = applyWeekSave(source, request, "person:1", allowed, "2026-11-04T12:00:00Z", new Map([["legacy:site", "site:1"]]));
  assert.equal(saved.snapshot.entries[0].allocations[0].destinationId, "site:1"); assert.equal(source.entries[0].allocations[0].destinationId, "legacy:site");
  assert.throws(() => applyWeekSave(source, { ...request, changes: { ...request.changes, updates: [{ ...request.changes.updates[0], patch: { allocations: [{ destinationId: "site:2", destinationLabel: "Other", quantity: 12 }] } }] } }, "person:1", allowed), /scope/);
});
test("week-only and template rows save atomically and replay without duplicate settings or audit", async () => {
  const source = await getWeek("rolling-week:2099-01-05"); const draft = editWeek(source, "add-menu-slot", { category: "Garnish", persistence: "template" });
  const slot = draft.week.customSlots!.at(-1)!; const request = { weekId: source.week.id, expectedWeekVersion: source.week.version, requestId: "request-template-row", changes: { ...weekChanges(source, draft), templateAdditions: [slot] } };
  const first = await saveWeekDraft(request, "person:1", allowed); const replay = await saveWeekDraft(request, "person:1", allowed);
  const { getMenuTemplateSlots } = await import("../lib/operational-store");
  assert.equal(first.snapshot.week.customSlots?.filter(value => value === slot).length, 1); assert.equal((await getMenuTemplateSlots()).filter(value => value === slot).length, 1); assert.equal(replay.replayed, true); assert.equal(replay.snapshot.week.version, first.snapshot.week.version);
});
