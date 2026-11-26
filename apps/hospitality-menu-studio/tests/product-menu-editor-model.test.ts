import assert from "node:assert/strict";
import test from "node:test";
import { productMenuConfiguration, productMenuDraft, type ProductMenuDraft } from "../../shared/hospitality-menu-studio-product-content";
import { copyProductMenuWeeks, menuChoiceReferences, moveProductMenuDish, reconfigureProductMenu, removeProductMenuGroup } from "../components/product-menu-editor-model";
import { ProductMenuDraftEditor, productMenuRecoveryKey } from "../components/use-product-menu-editor-draft";

const blank = () => ({ dishes: [], groups: [] });
const dish = (dishId: string, revision = 1) => ({ dishId, revision });
const monday = "2026-11-30";

test("removing a group keeps dish revisions in every rotation week, including weeks without the destination group", () => {
  const retained = { dishId: "retained", revision: 1 };
  const oldRevision = { dishId: "moved", revision: 2 };
  const recentRevision = { dishId: "moved", revision: 4 };
  const source = productMenuConfiguration.parse({
    presentation: "quantities",
    groups: [{ id: "keep", name: "Keep" }, { id: "remove", name: "Remove" }],
    schedule: { kind: "rotation", anchorMonday: "2026-11-30", weeks: [
      { dishes: [], groups: [{ groupId: "remove", dishes: [oldRevision] }] },
      { dishes: [], groups: [{ groupId: "keep", dishes: [retained] }, { groupId: "remove", dishes: [recentRevision] }] },
      { dishes: [], groups: [] },
    ] },
  });
  const result = productMenuConfiguration.parse(removeProductMenuGroup(source, "remove"));
  assert.deepEqual(result.groups, [{ id: "keep", name: "Keep" }]);
  assert.equal(result.schedule.kind, "rotation");
  assert.deepEqual(result.schedule.weeks.map(slot => slot.groups), [
    [{ groupId: "keep", dishes: [oldRevision] }],
    [{ groupId: "keep", dishes: [retained, recentRevision] }],
    [],
  ]);
  const ungrouped = productMenuConfiguration.parse(removeProductMenuGroup(result, "keep"));
  assert.equal(ungrouped.schedule.kind, "rotation");
  assert.deepEqual(ungrouped.schedule.weeks.map(menuChoiceReferences), [[oldRevision], [retained, recentRevision], []]);
  assert.ok(ungrouped.schedule.weeks.every(slot => !slot.groups.length));
});

test("conversion from fixed preserves revisions and grouping for one through 52 weeks", () => {
  const source = productMenuConfiguration.parse({
    presentation: "dropdown", groups: [{ id: "first", name: "First", presentation: "dropdown" }],
    schedule: { kind: "fixed", choices: { dishes: [], groups: [{ groupId: "first", dishes: [dish("choice", 3)] }] } },
  });
  for (const cycleWeeks of [1, 2, 6, 52]) {
    const result = reconfigureProductMenu(source, { kind: "rotation", anchorMonday: monday, cycleWeeks });
    assert.equal(result.status, "applied");
    const configured = productMenuConfiguration.parse(result.configuration);
    assert.equal(configured.schedule.kind, "rotation");
    assert.equal(configured.schedule.weeks.length, cycleWeeks);
    assert.deepEqual(configured.groups, source.groups);
    assert.deepEqual(menuChoiceReferences(configured.schedule.weeks[0]), [dish("choice", 3)]);
    assert.ok(configured.schedule.weeks.slice(1).every(slot => !menuChoiceReferences(slot).length));
  }
  for (const cycleWeeks of [0, 53, 1.5]) {
    assert.equal(reconfigureProductMenu(source, { kind: "rotation", anchorMonday: monday, cycleWeeks }).status, "invalid");
  }
  for (const anchorMonday of ["2026-12-01", "2026-02-30", "bad-date"]) {
    assert.equal(reconfigureProductMenu(source, { kind: "rotation", anchorMonday, cycleWeeks: 3 }).status, "invalid");
  }
});

test("shortening and converting a rotation disclose discarded slots and require explicit confirmation", () => {
  const source = productMenuConfiguration.parse({
    presentation: "quantities", groups: [],
    schedule: { kind: "rotation", anchorMonday: monday, weeks: [
      { ...blank(), dishes: [dish("first")] }, blank(), { ...blank(), dishes: [dish("third", 5)] }, blank(),
    ] },
  });
  const shrink = { kind: "rotation", anchorMonday: monday, cycleWeeks: 2, weekIndex: 2 } as const;
  assert.deepEqual(reconfigureProductMenu(source, shrink), {
    status: "confirmation-required", lostWeeks: [{ weekIndex: 2, dishCount: 1 }, { weekIndex: 3, dishCount: 0 }],
  });
  const shortened = reconfigureProductMenu(source, shrink, true);
  assert.equal(shortened.status, "applied");
  assert.equal(shortened.weekIndex, 1);
  assert.equal(shortened.configuration.schedule.kind, "rotation");
  assert.deepEqual(shortened.configuration.schedule.weeks.map(menuChoiceReferences), [[dish("first")], []]);
  const fixed = { kind: "fixed", weekIndex: 2 } as const;
  assert.deepEqual(reconfigureProductMenu(source, fixed), {
    status: "confirmation-required", lostWeeks: [{ weekIndex: 0, dishCount: 1 }, { weekIndex: 1, dishCount: 0 }, { weekIndex: 3, dishCount: 0 }],
  });
  const converted = reconfigureProductMenu(source, fixed, true);
  assert.equal(converted.status, "applied");
  assert.equal(converted.configuration.schedule.kind, "fixed");
  assert.deepEqual(menuChoiceReferences(converted.configuration.schedule.choices), [dish("third", 5)]);
  assert.equal(source.schedule.kind, "rotation");
  assert.equal(source.schedule.weeks.length, 4);
});

test("bulk append deduplicates across groups and replacement preserves source order and revisions", () => {
  const source = productMenuConfiguration.parse({
    presentation: "quantities", groups: [{ id: "hot", name: "Hot" }, { id: "cold", name: "Cold" }],
    schedule: { kind: "rotation", anchorMonday: monday, weeks: [
      { dishes: [], groups: [{ groupId: "hot", dishes: [dish("shared", 3), dish("hot-choice", 2)] }, { groupId: "cold", dishes: [dish("cold-choice", 5)] }] },
      { dishes: [], groups: [{ groupId: "cold", dishes: [dish("shared", 1), dish("existing")] }] },
      blank(), blank(),
    ] },
  });
  const copy = { sourceWeek: 0, targetWeeks: [1, 2, 2], mode: "append" } as const;
  const append = copyProductMenuWeeks(source, copy);
  assert.equal(append.status, "applied");
  const valid = productMenuConfiguration.parse(append.configuration);
  assert.equal(valid.schedule.kind, "rotation");
  assert.deepEqual(valid.schedule.weeks[1].groups, [
    { groupId: "cold", dishes: [dish("shared", 1), dish("existing"), dish("cold-choice", 5)] },
    { groupId: "hot", dishes: [dish("hot-choice", 2)] },
  ]);
  assert.deepEqual(valid.schedule.weeks[2], valid.schedule.weeks[0]);
  assert.equal(copyProductMenuWeeks(append.configuration, copy).status, "applied");
  const repeat = copyProductMenuWeeks(append.configuration, copy);
  assert.equal(repeat.status, "applied");
  assert.equal(repeat.configuration, append.configuration);
  assert.deepEqual(copyProductMenuWeeks(source, { ...copy, mode: "replace" }), {
    status: "confirmation-required", lostWeeks: [{ weekIndex: 1, dishCount: 2 }],
  });
  const replace = copyProductMenuWeeks(source, { ...copy, mode: "replace", confirmedReplace: true });
  assert.equal(replace.status, "applied");
  assert.equal(replace.configuration.schedule.kind, "rotation");
  assert.deepEqual(replace.configuration.schedule.weeks[1], replace.configuration.schedule.weeks[0]);
  assert.notEqual(replace.configuration.schedule.weeks[1], replace.configuration.schedule.weeks[2]);
  assert.deepEqual(replace.configuration.schedule.weeks[3], blank());
  assert.equal(copyProductMenuWeeks(source, { ...copy, targetWeeks: [0, 3] }).status, "invalid");
});

test("moving a dish by stable ID within and between groups keeps its archived revision", () => {
  const source = productMenuConfiguration.parse({
    presentation: "quantities", groups: [{ id: "hot", name: "Hot" }, { id: "cold", name: "Cold" }],
    schedule: { kind: "fixed", choices: { dishes: [], groups: [{ groupId: "hot", dishes: [dish("first", 2), dish("second", 9)] }] } },
  });
  const first = moveProductMenuDish(source, { weekIndex: 0, dishId: "first", toGroupId: "hot", toIndex: 1 });
  assert.equal(first.status, "applied");
  const next = moveProductMenuDish(first.configuration, { weekIndex: 0, dishId: "second", toGroupId: "cold", toIndex: 0 });
  assert.equal(next.status, "applied");
  const valid = productMenuConfiguration.parse(next.configuration);
  assert.equal(valid.schedule.kind, "fixed");
  assert.deepEqual(valid.schedule.choices.groups, [
    { groupId: "hot", dishes: [dish("first", 2)] }, { groupId: "cold", dishes: [dish("second", 9)] },
  ]);
  assert.equal(moveProductMenuDish(valid, { weekIndex: 0, dishId: "second", toGroupId: "missing", toIndex: 0 }).status, "invalid");
  assert.equal(moveProductMenuDish(valid, { weekIndex: 0, dishId: "second", toGroupId: "hot", toIndex: 2 }).status, "invalid");
});

const scope = "a".repeat(64);
const base = productMenuDraft.parse({
  schemaVersion: 1, itemId: "hospitality-menu-item:test-product", version: 1, updatedAt: "2026-11-26T10:00:00.000Z",
  configuration: { presentation: "quantities", groups: [], schedule: { kind: "fixed", choices: blank() } },
});
const acknowledgement = (snapshot: ProductMenuDraft) => ({ ...snapshot, version: snapshot.version + 1 });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test("debounced edits serialize and a newer edit uses the latest acknowledged version", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const storage = memoryStorage();
  const calls: ProductMenuDraft[] = [];
  let finish!: (value: ProductMenuDraft) => void;
  const editor = new ProductMenuDraftEditor(base, scope, () => ({
    canManage: true, onSave: async snapshot => {
      calls.push(snapshot);
      if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
      return acknowledgement(snapshot);
    },
  }));
  context.after(editor.connect(storage));
  editor.change(current => ({ ...current, presentation: "checkboxes" }));
  context.mock.timers.tick(500);
  editor.change(current => ({ ...current, presentation: "dropdown" }));
  context.mock.timers.tick(899);
  assert.equal(calls.length, 0);
  context.mock.timers.tick(1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].configuration.presentation, "dropdown");
  editor.change(current => ({ ...current, presentation: "checkboxes" }));
  const pending = editor.save();
  assert.equal(calls.length, 1);
  finish(acknowledgement(calls[0]));
  assert.equal(await pending, false);
  assert.equal(editor.snapshot().configuration.presentation, "checkboxes");
  assert.equal(await editor.save(), true);
  assert.deepEqual(calls.map(value => value.version), [1, 2]);
  assert.equal(editor.snapshot().status, "saved");
  assert.equal(storage.getItem(productMenuRecoveryKey(scope, base.itemId)!), null);
});

test("an unknown save result retries the exact sent snapshot before newer local work", async context => {
  const storage = memoryStorage();
  const calls: ProductMenuDraft[] = [];
  const editor = new ProductMenuDraftEditor(base, scope, () => ({
    canManage: true, onSave: async snapshot => {
      calls.push(snapshot);
      if (calls.length === 1) throw new Error("Connection lost");
      return acknowledgement(snapshot);
    },
  }));
  context.after(editor.connect(storage));
  editor.change(current => ({ ...current, presentation: "dropdown" }));
  assert.equal(await editor.save(), false);
  editor.change(current => ({ ...current, presentation: "checkboxes" }));
  assert.equal(await editor.save(), false);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(await editor.save(), true);
  assert.equal(calls[2].version, 2);
  assert.equal(calls[2].configuration.presentation, "checkboxes");
});

test("a conflict never posts against a newer draft and can reopen the latest while preserving edits", async context => {
  const storage = memoryStorage();
  const latest: ProductMenuDraft = { ...base, version: 2, configuration: { ...base.configuration, presentation: "checkboxes" } };
  let saves = 0;
  const editor = new ProductMenuDraftEditor(base, scope, () => ({
    canManage: true, onSave: async () => { saves++; throw Object.assign(new Error("Conflict"), { status: 409 }); },
    onLoadLatest: async () => latest,
  }));
  context.after(editor.connect(storage));
  editor.change(current => ({ ...current, presentation: "dropdown" }));
  assert.equal(await editor.save(), false);
  assert.equal(editor.snapshot().status, "conflict");
  assert.equal(await editor.save(), false);
  assert.equal(await editor.openLatest(), true);
  assert.equal(editor.snapshot().configuration.presentation, "checkboxes");
  assert.equal(editor.snapshot().recovery?.draft.configuration.presentation, "dropdown");
  assert.equal(editor.resumeRecovery(), true);
  assert.equal(editor.snapshot().status, "conflict");
  assert.equal(editor.snapshot().configuration.presentation, "dropdown");
  assert.equal(await editor.save(), false);
  assert.equal(saves, 1);
});

test("tab reload offers recovery explicitly and cannot access a different authority scope", async context => {
  const storage = memoryStorage();
  let saves = 0;
  const access = () => ({
    canManage: true, onSave: async (snapshot: ProductMenuDraft) => { saves++; return acknowledgement(snapshot); },
  });
  const original = new ProductMenuDraftEditor(base, scope, access);
  const disconnect = original.connect(storage);
  original.change(current => ({ ...current, presentation: "dropdown" }));
  disconnect();
  const other = new ProductMenuDraftEditor(base, "b".repeat(64), access);
  context.after(other.connect(storage));
  assert.equal(other.snapshot().recovery, null);
  const restored = new ProductMenuDraftEditor(base, scope, access);
  context.after(restored.connect(storage));
  assert.equal(restored.snapshot().configuration.presentation, "quantities");
  assert.equal(restored.snapshot().recovery?.draft.configuration.presentation, "dropdown");
  assert.equal(await restored.save(), false);
  assert.equal(saves, 0);
  assert.equal(restored.resumeRecovery(), true);
  assert.equal(await restored.save(), true);
  assert.equal(saves, 1);
});

test("a mismatched save acknowledgement leaves local edits available without retrying on a timer", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const storage = memoryStorage();
  let saves = 0;
  const editor = new ProductMenuDraftEditor(base, scope, () => ({
    canManage: true,
    onSave: async snapshot => { saves++; return { ...acknowledgement(snapshot), itemId: "other-product" }; },
  }));
  context.after(editor.connect(storage));
  editor.change(current => ({ ...current, presentation: "dropdown" }));
  assert.equal(await editor.save(), false);
  assert.equal(editor.snapshot().status, "error");
  const key = productMenuRecoveryKey(scope, base.itemId)!;
  assert.notEqual(storage.getItem(key), null);
  context.mock.timers.tick(10_000);
  assert.equal(saves, 1);
  assert.equal(editor.snapshot().configuration.presentation, "dropdown");
});
