import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";
import type { PlannedMenuItem } from "../app/lib/production-plan";
import { hasAllergenAuthority } from "../app/lib/production-plan-state";
import { autosaveAction, checkRowInItems, createAutosaveController, displayAllergenMap, guardedEdit, reviewProgress, reviewStatusCopy, rowCanBeChecked, signingGate, toggleCellInItems } from "../app/ui/allergen-review-persistence";

const explicit = (state: "clear" | "contains" | "may_contain" = "clear") => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, state]));
const row = (id: string, over: Partial<PlannedMenuItem["subItems"][number]> = {}): PlannedMenuItem => ({ id: `mi-${id}`, sourceLineId: `line-${id}`, name: `Item ${id}`, note: "", subItems: [{ id: `s-${id}`, name: `Filling ${id}`, quantity: 5, allergens: explicit() as never, note: "", evidenceStatus: "not_completed", ...over }] });
const completeItems = () => [row("1", { evidenceStatus: "completed", allergens: { ...explicit(), milk: "contains", no_key_allergens: "clear" } as never }), row("2", { evidenceStatus: "completed" })];
const manual = () => {
  const queue: Array<{ id: number; fn: () => void; ms: number }> = []; let next = 1;
  return { set: (fn: () => void, ms: number) => { const id = next++; queue.push({ id, fn, ms }); return id; }, clear: (id: unknown) => { const i = queue.findIndex(entry => entry.id === id); if (i >= 0) queue.splice(i, 1); }, pending: () => queue.length, fire: () => { const entry = queue.shift(); entry?.fn(); }, ms: () => queue[0]?.ms };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("a not-checked allergen is never implicitly accepted: the row cannot be checked and signing is blocked", () => {
  const unchecked = row("1", { allergens: { ...explicit(), milk: "unrecorded", eggs: undefined } as never });
  assert.equal(displayAllergenMap(unchecked.subItems[0].allergens).milk, "unrecorded");
  assert.equal(displayAllergenMap(unchecked.subItems[0].allergens).eggs, "unrecorded", "an omitted allergen is displayed as not checked, never as clear");
  assert.equal(rowCanBeChecked(unchecked.subItems[0]), false);
  const attempt = checkRowInItems([unchecked], unchecked.id, unchecked.subItems[0].id, false);
  assert.equal(attempt.changed, false); assert.equal(attempt.reason, "not_checked");
  assert.equal(attempt.items[0].subItems[0].evidenceStatus, "not_completed");
  // even a row forced to "completed" (stale/hand-edited) cannot open the signing gate while an allergen is unrecorded
  const forged = [row("1", { evidenceStatus: "completed", allergens: { ...explicit(), milk: "unrecorded" } as never })];
  assert.deepEqual(signingGate({ menuItems: forged, persistence: "saved", serverPlanStatus: "planned", readOnly: false }), { canSign: false, block: "unchecked" });
});

test("toggling cycles from the displayed state: not checked -> free from -> contains -> may contain -> free from", () => {
  let items = [row("1", { allergens: { milk: "unrecorded" } as never })];
  const states: string[] = [];
  for (let i = 0; i < 4; i += 1) { items = toggleCellInItems(items, "mi-1", "s-1", "milk", false); states.push(displayAllergenMap(items[0].subItems[0].allergens).milk); }
  assert.deepEqual(states, ["clear", "contains", "may_contain", "clear"]);
  // an omitted key behaves like a not-checked cell (first click is an explicit free-from, not "contains")
  const omitted = toggleCellInItems([row("1", { allergens: {} as never })], "mi-1", "s-1", "peanuts", false);
  assert.equal(omitted[0].subItems[0].allergens.peanuts, "clear");
  assert.equal(omitted[0].subItems[0].evidenceStatus, "not_completed", "editing a cell reopens the row's check");
});

test("progress and status copy", () => {
  const items = [row("1", { allergens: { ...explicit(), milk: "unrecorded", eggs: "unrecorded" } as never }), row("2")];
  const progress = reviewProgress(items);
  assert.equal(progress.total, 2 * CANONICAL_ALLERGEN_KEYS.length); assert.equal(progress.checked, progress.total - 3, "milk, eggs and the derived 'No key allergens' are not checked");
  assert.match(reviewStatusCopy({ progress, persistence: "saved", serverPlanStatus: "planning", readOnly: false }), new RegExp(`^${progress.checked} of ${progress.total} allergens checked`));
  const done = reviewProgress(completeItems());
  assert.equal(done.complete, true);
  assert.equal(reviewStatusCopy({ progress: done, persistence: "saved", serverPlanStatus: "planned", readOnly: false }), "All allergens reviewed · Ready for chef approval");
  assert.match(reviewStatusCopy({ progress: done, persistence: "saving", serverPlanStatus: "planned", readOnly: false }), /saving before chef approval/);
  assert.match(reviewStatusCopy({ progress: done, persistence: "saved", serverPlanStatus: "planned", readOnly: true }), /read-only/i);
});

test("persistence picks the existing command: partial review -> save-plan, complete review -> mark-planned", () => {
  assert.equal(autosaveAction([row("1", { allergens: { ...explicit(), milk: "unrecorded" } as never })]), "save-plan");
  assert.equal(autosaveAction([row("1")]), "save-plan", "an unchecked row is still a partial review");
  assert.equal(autosaveAction(completeItems()), "mark-planned");
});

test("partial edits autosave after the debounce and coalesce into one save of the newest state", async () => {
  const timers = manual(); const saved: number[] = []; const statuses: string[] = [];
  const controller = createAutosaveController<number>({ save: async value => { saved.push(value); }, onChange: state => statuses.push(state.status), timers });
  controller.edit(1); controller.edit(2); controller.edit(3);
  assert.equal(timers.pending(), 1, "each edit re-arms a single debounce"); assert.equal(timers.ms(), 800);
  assert.deepEqual(saved, [], "nothing is saved before the debounce");
  timers.fire(); await settle();
  assert.deepEqual(saved, [3], "one save of the newest state");
  assert.equal(controller.state.status, "saved");
  assert.deepEqual([...new Set(statuses)], ["dirty", "saving", "saved"]);
});

test("a row check saves immediately; an edit made while saving is saved afterwards and the review is only clean after both", async () => {
  const timers = manual(); const saved: string[] = []; let release: (() => void) | undefined;
  const controller = createAutosaveController<string>({ save: value => new Promise<void>(resolve => { saved.push(value); release = resolve; }), timers });
  controller.edit("row-check", { immediate: true });
  assert.equal(timers.pending(), 0, "an immediate save does not wait for the debounce");
  await settle(); assert.deepEqual(saved, ["row-check"]); assert.equal(controller.state.status, "saving");
  controller.edit("typed-while-saving"); assert.equal(controller.state.status, "dirty");
  release!(); await settle();
  timers.fire(); await settle(); // debounce for the newer edit
  assert.deepEqual(saved, ["row-check", "typed-while-saving"]);
  release!(); await settle();
  assert.equal(controller.state.status, "saved");
});

test("signing: dirty, saving and error persistence can never sign; flushing first makes it signable", async () => {
  const items = completeItems();
  const base = { menuItems: items, serverPlanStatus: "planned", readOnly: false };
  assert.equal(signingGate({ ...base, persistence: "saved" }).canSign, true);
  assert.deepEqual(signingGate({ ...base, persistence: "dirty" }), { canSign: false, block: "dirty" });
  assert.deepEqual(signingGate({ ...base, persistence: "saving" }), { canSign: false, block: "saving" });
  assert.deepEqual(signingGate({ ...base, persistence: "error" }), { canSign: false, block: "error" });
  assert.deepEqual(signingGate({ ...base, persistence: "saved", serverPlanStatus: "planning" }), { canSign: false, block: "not_planned" });
  assert.deepEqual(signingGate({ ...base, persistence: "saved", busy: true }), { canSign: false, block: "saving" });
  assert.equal(signingGate({ menuItems: [row("1")], persistence: "saved", serverPlanStatus: "planned", readOnly: false }).canSign, false, "an unchecked row blocks signing");
  // clicking Sign flushes the pending save, THEN re-evaluates the gate
  const timers = manual(); const saved: number[] = [];
  const controller = createAutosaveController<number>({ save: async value => { saved.push(value); }, timers });
  controller.edit(7);
  assert.equal(signingGate({ ...base, persistence: controller.state.status }).canSign, false);
  assert.equal(await controller.flush(), true);
  assert.deepEqual(saved, [7]); assert.equal(timers.pending(), 0, "the debounce was cancelled by the flush");
  assert.equal(signingGate({ ...base, persistence: controller.state.status }).canSign, true);
});

test("a failed save shows an error, blocks signing, and a retry of the same state recovers", async () => {
  const timers = manual(); let fail = true; const saved: number[] = [];
  const controller = createAutosaveController<number>({ save: async value => { if (fail) throw new Error("network down"); saved.push(value); }, timers });
  controller.edit(1);
  assert.equal(await controller.flush(), false);
  assert.deepEqual(controller.state, { status: "error", error: "network down" });
  assert.equal(signingGate({ menuItems: completeItems(), persistence: controller.state.status, serverPlanStatus: "planned", readOnly: false }).block, "error");
  fail = false;
  assert.equal(await controller.retry(), true);
  assert.deepEqual(saved, [1]); assert.equal(controller.state.status, "saved");
});

test("read-only (any signature, release or signed artifact): cell clicks and every other edit are no-ops and autosave never runs", async () => {
  const items = completeItems();
  const partiallySigned = hasAllergenAuthority({ signatures: [{ role: "production_chef" } as never], matrixArtifact: undefined, currentAllergenRelease: undefined } as never);
  const released = hasAllergenAuthority({ signatures: [], matrixArtifact: undefined, currentAllergenRelease: { releaseId: "r" } as never } as never);
  const artifact = hasAllergenAuthority({ signatures: [], matrixArtifact: { id: "a" } as never, currentAllergenRelease: undefined } as never);
  assert.deepEqual([partiallySigned, released, artifact], [true, true, true], "one signature, a release, or an artifact each lock the matrix");
  assert.equal(toggleCellInItems(items, "mi-1", "s-1", "milk", true), items, "the same reference: nothing changed");
  const check = checkRowInItems(items, "mi-1", "s-1", true);
  assert.equal(check.items, items); assert.equal(check.changed, false); assert.equal(check.reason, "read_only");
  assert.equal(guardedEdit(items, true, () => [] as PlannedMenuItem[]), items);
  assert.deepEqual(guardedEdit(items, false, () => [] as PlannedMenuItem[]), []);
  const timers = manual(); const saved: number[] = [];
  const controller = createAutosaveController<number>({ save: async value => { saved.push(value); }, timers });
  controller.setReadOnly(true);
  assert.equal(controller.edit(1), false); assert.equal(controller.edit(2, { immediate: true }), false);
  assert.equal(timers.pending(), 0); await controller.flush();
  assert.equal(saved.length, 0, "autosave never runs while read-only");
  assert.equal(controller.state.status, "saved");
  // a pending debounce is cancelled the moment the matrix becomes read-only
  const timers2 = manual(); const controller2 = createAutosaveController<number>({ save: async value => { saved.push(value); }, timers: timers2 });
  controller2.edit(5); assert.equal(timers2.pending(), 1); controller2.setReadOnly(true); assert.equal(timers2.pending(), 0);
});

test("a PARTLY signed matrix is locked for editing but still signable by the missing role; a fully signed one is not", () => {
  const items = completeItems();
  const lockedButOneSignature = signingGate({ menuItems: items, persistence: "saved", serverPlanStatus: "planned", readOnly: false /* the editor passes fullySigned */ });
  assert.equal(lockedButOneSignature.canSign, true);
  assert.deepEqual(signingGate({ menuItems: items, persistence: "saved", serverPlanStatus: "planned", readOnly: true }), { canSign: false, block: "read_only" });
  // the edit lock itself is independent: any signature locks edits
  assert.equal(hasAllergenAuthority({ signatures: [{ role: "production_chef" } as never], matrixArtifact: undefined, currentAllergenRelease: undefined } as never), true);
});
