import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RollingSnapshot } from "../lib/rolling-menu-types";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";
import { editWeek, weekChanges } from "../lib/week-draft";

const directory = mkdtempSync(join(tmpdir(), "fika-week-draft-337-"));
process.chdir(directory); process.env.MENU_PLANNING_DB_PATH = join(directory, "isolated.sqlite"); process.env.MENU_PLANNING_TEST_MODE = "1";
const { applyWeekSave, requestValidationErrors, saveWeekDraft } = await import("../lib/week-draft-save");
const { createCanonicalMenuItem } = await import("../lib/canonical-menu-repository");
const { emptyWeek, saveSnapshot, getWeek } = await import("../lib/rolling-menu");
const { readPublicationState, updatePublicationState } = await import("../lib/operational-store");
const { categoriesForMenuSlot } = await import("../lib/dish-categories");
const { isGovernedMenuSlot } = await import("../lib/menu-template");
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
test("explicit published working-draft save persists rolling rows only and preserves immutable publication and outbox", async () => {
  const source = emptyWeek("2099-02-02", "fixture-actor"); const day = source.days[0]; const entry = { id: `${source.week.id}:entry:one`, dayId: day.id, date: day.date, slot: "GARNISH 1", itemId: "dish:fixture", itemLabel: "Almonds", portions: 12, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 12 }], allergens: { nuts: "contains" as const }, audit: [] };
  source.entries.push(entry); source.week.entryIds.push(entry.id); day.entryIds.push(entry.id); source.week.status = "published"; source.week.dayStatuses = { [day.id]: "published" }; await saveSnapshot(source);
  const publication = { publicationId: `menu-publication:${source.week.id}`, sourceWeekId: source.week.id, weekCommencing: source.week.weekCommencing, weekEnding: source.week.weekEnding, publicationVersion: 1, publicationStatus: "published", days: [{ publicationDayId: "publication-day:immutable-v1", sourceDayId: source.days[0].id, date: source.days[0].date, dayName: source.days[0].dayName, version: 1, status: "published", contentHash: "immutable-hash-v1", entries: [{ id: source.entries[0].id, itemId: source.entries[0].itemId, itemLabel: source.entries[0].itemLabel, slot: source.entries[0].slot, portions: 12, allocations: structuredClone(source.entries[0].allocations) }] }], audit: [{ action: "published", at: "2026-01-01T00:00:00Z", by: "publisher" }] };
  await updatePublicationState<{ publications: unknown[]; events: unknown[] }>(state => { state.publications.push(publication); });
  const beforePublication = await readPublicationState<{ publications: unknown[]; events: unknown[] }>(); const beforeRolling = await getWeek(source.week.id);
  const draft = { ...source, entries: [{ ...source.entries[0], itemLabel: "Working draft name", portions: 15, allocations: [{ ...source.entries[0].allocations[0], quantity: 15 }] }] };
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-working-draft", workingDraft: true, changes: weekChanges(source, draft) };
  const saved = await saveWeekDraft(request, "person:1", allowed);
  assert.equal(saved.snapshot.entries[0].itemLabel, "Working draft name"); assert.equal(saved.snapshot.entries[0].portions, 15);
  assert.equal(saved.snapshot.week.status, "published"); assert.equal(saved.snapshot.week.dayStatuses?.[source.days[0].id], "published");
  assert.equal((await getWeek(source.week.id)).week.version, 2);
  const afterPublication = await readPublicationState<{ publications: unknown[]; events: unknown[] }>();
  assert.deepEqual(afterPublication.publications, beforePublication.publications); assert.deepEqual(afterPublication.events, beforePublication.events);
  assert.equal(beforeRolling.entries[0].itemLabel, "Almonds");
});
test("a newly marked Core Salad survives the first save and forged review evidence is rejected", async () => {
  const dish = await createCanonicalMenuItem({ displayName: "Fixture salad 378", category: "Salad" }, "fixture-actor");
  const source = await getWeek("rolling-week:2099-01-05");
  const entryId = `${source.week.id}:entry:new-salad`;
  const placed = editWeek(source, "create-entry", { id: entryId, dayId: source.days[0].id, slot: "SALAD 1", itemId: dish.canonicalId, itemLabel: dish.displayName });
  const draft = editWeek(placed, "update-entry", { entryId, patch: { isCoreSalad: true } });
  const request = { weekId: source.week.id, expectedWeekVersion: source.week.version, requestId: "request-create-entry", changes: weekChanges(source, draft) };
  const saved = await saveWeekDraft(request, "person:1", allowed); assert.equal(saved.snapshot.entries[0].id, source.entries[0].id); assert.equal(saved.snapshot.entries[1].itemId, dish.canonicalId); assert.deepEqual(saved.snapshot.entries[1].allergens, {});
  assert.equal((await getWeek(source.week.id)).entries.find(entry => entry.id === entryId)?.isCoreSalad, true);
  const forged = { ...request, changes: { ...request.changes, updates: [{ entryId: source.entries[0].id, dayId: source.days[0].id, patch: { allergenReview: { by: "fake" } } }] } };
  await assert.rejects(saveWeekDraft(forged, "person:1", allowed), /invalid entries/);
});
test("a full-week save preserves all 95 planned dishes", () => {
  const source = emptyWeek("2099-04-06", "fixture-actor");
  const slots = source.week.templateSlots!.slice(0, 14);
  assert.equal(slots.length, 14);
  const creates = Array.from({ length: 95 }, (_, index) => {
    const day = source.days[Math.floor(index / 14)];
    const slot = slots[index % 14];
    const copiedNoodleSalad = index === 80;
    return { id: `${source.week.id}:entry:fixture-${index}`, dayId: day.id, slot, itemId: `dish:fixture-${index}`, itemLabel: copiedNoodleSalad ? "Noodle Salad with Edamame Beans" : `Fixture dish ${index}`, portions: 0, allocations: [] };
  });
  // The copied salad remains a valid placement in the target's selected governed row.
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-full-week-95", changes: { updates: [], creates } };
  const saved = applyWeekSave(source, request, "person:1", allowed).snapshot;
  assert.equal(saved.entries.length, 95);
  assert.equal(saved.entries[80].dayId, source.days[5].id);
  assert.equal(saved.entries[80].slot, creates[80].slot);
  assert.equal(saved.entries[80].itemLabel, "Noodle Salad with Edamame Beans");
  assert.equal(saved.week.version, 2);
});
test("all 18 affected canonical slot placements save and reload without changing publication or outbox state", async () => {
  const source = emptyWeek("2099-05-04", "fixture-actor");
  const weekdaySlots = [
    ["COLD PROTEIN MEAT", "HOT FISH", "HOT VEGAN", "COLD PROTEIN FISH"],
    ["COLD PROTEIN MEAT", "HOT FISH", "HOT VEGAN"],
    ["COLD PROTEIN MEAT", "HOT FISH", "HOT VEGAN", "COLD PROTEIN FISH"],
    ["COLD PROTEIN MEAT", "HOT FISH", "HOT VEGAN", "COLD PROTEIN FISH"],
    ["COLD PROTEIN MEAT", "HOT VEGAN", "COLD PROTEIN FISH"],
  ];
  const dishes = new Map<string, Awaited<ReturnType<typeof createCanonicalMenuItem>>>();
  for (const slot of [...new Set(weekdaySlots.flat())]) {
    const category = categoriesForMenuSlot(slot)[0];
    if (!dishes.has(category)) dishes.set(category, await createCanonicalMenuItem({ displayName: `Slot validation ${category}`, category }, "fixture-actor"));
  }
  // Build after fixture dishes exist so the requests carry active canonical IDs.
  const entries = weekdaySlots.flatMap((slots, dayIndex) => slots.map(slot => {
    const dish = dishes.get(categoriesForMenuSlot(slot)[0])!;
    const day = source.days[dayIndex];
    return { id: `${source.week.id}:entry:canonical-${dayIndex}-${slot.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dayId: day.id, slot, itemId: dish.canonicalId, itemLabel: dish.displayName, portions: 0, allocations: [] };
  }));
  assert.equal(entries.length, 18);
  await saveSnapshot(source);
  const beforePublication = await readPublicationState();
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-canonical-slots", changes: { updates: [], creates: entries } };
  const saved = await saveWeekDraft(request, "person:1", allowed);
  const reloaded = await getWeek(source.week.id);
  assert.deepEqual(saved.snapshot.entries.map(({ dayId, slot, itemId, itemLabel }) => ({ dayId, slot, itemId, itemLabel })), entries.map(({ dayId, slot, itemId, itemLabel }) => ({ dayId, slot, itemId, itemLabel })));
  assert.deepEqual(reloaded.entries.map(({ dayId, slot, itemId, itemLabel }) => ({ dayId, slot, itemId, itemLabel })), entries.map(({ dayId, slot, itemId, itemLabel }) => ({ dayId, slot, itemId, itemLabel })));
  assert.equal(reloaded.week.version, 2);
  assert.deepEqual(await readPublicationState(), beforePublication);
});
test("a full 95-dish week using the governed canonical slot contract saves and reloads intact", async () => {
  const source = emptyWeek("2099-05-11", "fixture-actor");
  const slots = CANONICAL_MENU_SLOTS.slice(0, 19).map(item => item.id);
  const dishes = new Map<string, Awaited<ReturnType<typeof createCanonicalMenuItem>>>();
  for (const slot of slots) {
    const category = categoriesForMenuSlot(slot)[0];
    if (!dishes.has(category)) dishes.set(category, await createCanonicalMenuItem({ displayName: `Full-week ${category}`, category }, "fixture-actor"));
  }
  const entries = Array.from({ length: 95 }, (_, index) => {
    const dayIndex = Math.floor(index / slots.length);
    const slot = slots[index % slots.length];
    const dish = dishes.get(categoriesForMenuSlot(slot)[0])!;
    return { id: `${source.week.id}:entry:full-${index}`, dayId: source.days[dayIndex].id, slot, itemId: dish.canonicalId, itemLabel: dish.displayName, portions: 0, allocations: [] };
  });
  await saveSnapshot(source);
  const beforePublication = await readPublicationState();
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-canonical-full-week", changes: { updates: [], creates: entries } };
  await saveWeekDraft(request, "person:1", allowed);
  const reloaded = await getWeek(source.week.id);
  assert.equal(reloaded.entries.length, 95);
  assert.deepEqual(reloaded.entries.map(entry => entry.id), entries.map(entry => entry.id));
  assert.deepEqual(reloaded.entries.map(entry => entry.slot), entries.map(entry => entry.slot));
  assert.deepEqual(await readPublicationState(), beforePublication);
});
test("canonical slot validation stays strict for identities outside the governed rows", async () => {
  assert.deepEqual(CANONICAL_MENU_SLOTS.filter(slot => !isGovernedMenuSlot(slot.id)), []);
  assert.equal(isGovernedMenuSlot("HOT FISH EXTRA"), false);
  const source = emptyWeek("2099-05-18", "fixture-actor");
  await saveSnapshot(source);
  await assert.rejects(saveWeekDraft({ weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-invalid-slot", changes: { updates: [], creates: [{ id: `${source.week.id}:entry:invalid-slot`, dayId: source.days[0].id, slot: "HOT FISH EXTRA", itemLabel: "", portions: 0, allocations: [] }] } }, "person:1", allowed), error => {
    const value = error as { status?: number; validationErrors?: Array<{ field?: string; message?: string }> };
    assert.equal(value.status, 422);
    assert.equal(value.validationErrors?.[0]?.field, "slot");
    assert.match(value.validationErrors?.[0]?.message || "", /Choose a governed menu row/);
    return true;
  });
  assert.equal((await getWeek(source.week.id)).week.version, 1);
});
test("copying a dish to another day keeps the selected governed slot without rewriting its category", () => {
  const source = emptyWeek("2099-04-13", "fixture-actor");
  const sourceEntry = { id: `${source.week.id}:entry:monday-noodles`, dayId: source.days[0].id, date: source.days[0].date, slot: "VEG MAIN", itemId: "dish:noodle-salad", itemLabel: "Noodle Salad with Edamame Beans", portions: 0, allocations: [], allergens: {}, audit: [] };
  sourceEntry.slot = "SALAD 4";
  source.entries.push(sourceEntry); source.days[0].entryIds.push(sourceEntry.id); source.week.entryIds.push(sourceEntry.id);
  const draft = editWeek(source, "create-entry", { id: `${source.week.id}:entry:friday-copy`, dayId: source.days[4].id, slot: "SALAD 4", itemId: sourceEntry.itemId, itemLabel: sourceEntry.itemLabel });
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-copy-friday", changes: weekChanges(source, draft) };
  const saved = applyWeekSave(source, request, "person:1", allowed).snapshot;
  assert.equal(saved.entries.find(entry => entry.dayId === source.days[4].id)?.slot, "SALAD 4");
  assert.equal(saved.entries.find(entry => entry.dayId === source.days[4].id)?.itemId, "dish:noodle-salad");
  assert.equal(saved.entries.find(entry => entry.dayId === source.days[0].id)?.itemLabel, sourceEntry.itemLabel);
});
test("Core Salad slot relationship errors name the affected field and row", () => {
  const source = emptyWeek("2099-04-20", "fixture-actor");
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-invalid-core-slot", changes: { updates: [], creates: [{ id: `${source.week.id}:entry:bad-core`, dayId: source.days[4].id, slot: "HOT VEGAN", itemId: "dish:salad", itemLabel: "Noodle Salad", portions: 0, allocations: [], isCoreSalad: true }] } };
  assert.throws(() => applyWeekSave(source, request, "person:1", allowed), error => {
    const value = error as { message?: string; validationErrors?: Array<{ field?: string; dayId?: string; slot?: string; itemLabel?: string }> };
    assert.match(value.message || "", /Core Salad can only be marked/);
    assert.deepEqual(value.validationErrors?.[0], { path: "isCoreSalad", field: "isCoreSalad", message: "Core Salad can only be marked on one of the six salad placements.", dayId: source.days[4].id, slot: "HOT VEGAN", itemLabel: "Noodle Salad", itemId: "dish:salad" });
    return true;
  });
});
test("a working allocation with its governed destination snapshot passes strict save validation", async () => {
  const source = emptyWeek("2099-04-27", "fixture-actor");
  const entry = { id: `${source.week.id}:entry:destination`, dayId: source.days[0].id, date: source.days[0].date, slot: "GARNISH 1", itemId: "dish:fixture", itemLabel: "Almonds", portions: 12, allocations: [{ destinationId: "site:1", destinationLabel: "Fixture site", quantity: 12 }], allergens: {}, audit: [] };
  source.entries.push(entry); source.days[0].entryIds.push(entry.id); source.week.entryIds.push(entry.id);
  source.entries[0].allocations[0].destination = { kind: "governed", id: "site:1", label: "Fixture site" };
  await saveSnapshot(source);
  const draft = structuredClone(source);
  draft.entries[0].portions = 13;
  draft.entries[0].allocations[0].quantity = 13;
  const request = { weekId: source.week.id, expectedWeekVersion: 1, requestId: "request-destination-snapshot", changes: weekChanges(source, draft) };
  const saved = await saveWeekDraft(request, "person:1", allowed);
  assert.equal(saved.snapshot.entries[0].allocations[0].destination?.kind, "governed");
  assert.equal(saved.snapshot.entries[0].allocations[0].quantity, 13);
});
test("validation details identify the affected day, slot, dish and rejected allocation field", () => {
  const row = { entryId: "entry:1", dayId: "day:friday", patch: { allocations: [{ destination: { kind: "governed" } }] } };
  const errors = requestValidationErrors({ changes: { updates: [row] } }, [{ path: ["changes", "updates", 0, "patch", "allocations", 0, "destination"], message: "Unrecognized key", code: "unrecognized_keys", keys: ["destination"] }]);
  assert.deepEqual(errors[0], { path: "changes.updates.0.patch.allocations.0.destination", field: "destination", message: "Unsupported field: destination.", entryKind: "update", entryIndex: 0, dayId: "day:friday" });
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
