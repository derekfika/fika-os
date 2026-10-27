import test from "node:test";
import assert from "node:assert/strict";
import { planMenuDuplicate, type DuplicatePlanInput, type DuplicateTargetInput } from "../lib/menu-duplicate";
import type { RollingEntry, RollingSnapshot } from "../lib/rolling-menu-types";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const OPLOC_A = "oploc:site-a";
const OPLOC_B = "oploc:site-b";
const liveOplocs = new Map([[OPLOC_A, "Site A"], [OPLOC_B, "Site B"]]);
const dishCategoryById = new Map<string, string>([
  ["dish:chicken", "Cold Protein"],
  ["dish:beef", "Hot Main"],
  ["dish:soup", "Soup"],
  ["dish:salad", "Salad"],
]);

function week(weekCommencing: string, slots: string[] = ["COLD PROTEIN", "HOT MAIN", "SOUP", "SALAD 1"], customSlots: string[] = [], version = 3): RollingSnapshot {
  const id = `rolling-week:${weekCommencing}`;
  const days = dayNames.map((dayName, index) => {
    const date = new Date(`${weekCommencing}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { id: `${id}:day:${index + 1}`, date: date.toISOString().slice(0, 10), dayName, entryIds: [] as string[] };
  });
  return {
    week: { id, weekCommencing, weekEnding: days[6].date, status: "draft", version, dayIds: days.map(day => day.id), entryIds: [], sourceFiles: [], templateSlots: slots, customSlots, audit: [] },
    days,
    entries: [],
  };
}

function entry(snapshot: RollingSnapshot, dayIndex: number, slot: string, dish: { id: string; label: string } | undefined, allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }> = []): RollingEntry {
  const day = snapshot.days[dayIndex];
  const id = `${snapshot.week.id}:entry:${day.id}:${slot.toLowerCase().replace(/\s+/g, "-")}`;
  const item: RollingEntry = {
    id,
    dayId: day.id,
    date: day.date,
    slot,
    itemId: dish?.id,
    itemLabel: dish?.label || "",
    portions: allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
    allocations: allocations.map(allocation => ({ ...allocation })),
    allergens: {},
    audit: [],
  };
  snapshot.entries.push(item);
  day.entryIds.push(id);
  snapshot.week.entryIds.push(id);
  return item;
}

function plan(overrides: Partial<DuplicatePlanInput> & { targets: DuplicateTargetInput[] }, source: RollingSnapshot) {
  return planMenuDuplicate({
    source,
    scope: { kind: "week" },
    content: "menu",
    existing: "replace",
    dishCategoryById,
    liveOplocs,
    operationId: "op-test-0001",
    actor: "tester@fika",
    at: "2026-10-26T10:00:00.000Z",
    ...overrides,
  });
}

function target(snapshot: RollingSnapshot, overrides: Partial<DuplicateTargetInput> = {}): DuplicateTargetInput {
  return { weekCommencing: snapshot.week.weekCommencing, snapshot, isNewWeek: false, protectedDayIds: new Set(), placement: { kind: "corresponding" }, alreadyApplied: false, ...overrides };
}

function sourceWithMonday(allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }> = [{ destinationId: OPLOC_A, destinationLabel: "Site A", quantity: 10 }]) {
  const source = week("2026-11-02");
  entry(source, 0, "COLD PROTEIN", { id: "dish:chicken", label: "Chicken Breast" }, allocations);
  return source;
}

test("MENU copies the dish identity and slot, never the source quantities", () => {
  const source = sourceWithMonday();
  const targetSnapshot = week("2026-11-09");
  const result = plan({ content: "menu", targets: [target(targetSnapshot)] }, source);
  const copied = result.targets[0].next.entries.find(item => item.dayId === targetSnapshot.days[0].id)!;
  assert.equal(copied.itemId, "dish:chicken");
  assert.equal(copied.itemLabel, "Chicken Breast");
  assert.deepEqual(copied.allocations, []);
  assert.equal(copied.portions, 0);
  assert.equal(result.targets[0].dishesChanged, 1);
  assert.equal(result.targets[0].createdEntries, 1);
});

test("MENU on a changed dish keeps target allocations and reports them as retained", () => {
  const source = sourceWithMonday([]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:beef", label: "Chicken Breast Old" }, [{ destinationId: OPLOC_B, destinationLabel: "Site B", quantity: 7 }]);
  const beef = targetSnapshot.entries[0];
  beef.itemId = "dish:chicken";
  beef.itemLabel = "Chicken Breast Old";
  const result = plan({ content: "menu", existing: "replace", targets: [target(targetSnapshot)] }, source);
  const updated = result.targets[0].next.entries.find(item => item.id === beef.id)!;
  assert.equal(updated.itemLabel, "Chicken Breast");
  assert.deepEqual(updated.allocations.map(allocation => [allocation.destinationId, allocation.quantity]), [[OPLOC_B, 7]]);
  assert.equal(result.targets[0].overwrites.length, 1);
  assert.equal(result.targets[0].overwrites[0].fromDish, "Chicken Breast Old");
  assert.equal(result.targets[0].overwrites[0].toDish, "Chicken Breast");
  assert.equal(result.targets[0].overwrites[0].retainedAllocationRows, 1);
});

test("MENU fill-empty leaves occupied target dishes alone and reports them", () => {
  const source = sourceWithMonday();
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:beef", label: "Beef" });
  const result = plan({ content: "menu", existing: "fill-empty", targets: [target(targetSnapshot)] }, source);
  assert.equal(result.targets[0].next.entries[0].itemLabel, "Beef");
  assert.ok(result.targets[0].exceptions.some(item => item.kind === "occupied"));
  assert.equal(result.targets[0].changed, false);
});

test("PORTIONS keeps the target dish and copies allocations by canonical OPLOC", () => {
  const source = sourceWithMonday([{ destinationId: OPLOC_A, destinationLabel: "Site A", quantity: 10 }, { destinationId: OPLOC_B, destinationLabel: "Site B", quantity: 4 }]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:beef", label: "Different Dish" });
  const result = plan({ content: "portions", targets: [target(targetSnapshot)] }, source);
  const updated = result.targets[0].next.entries[0];
  assert.equal(updated.itemId, "dish:beef");
  assert.equal(updated.itemLabel, "Different Dish");
  assert.deepEqual(updated.allocations.map(allocation => [allocation.destinationId, allocation.destinationLabel, allocation.quantity]), [[OPLOC_A, "Site A", 10], [OPLOC_B, "Site B", 4]]);
  assert.equal(updated.portions, 14);
});

test("PORTIONS never fills a blank target slot or creates a dish", () => {
  const source = sourceWithMonday();
  const targetSnapshot = week("2026-11-09");
  const result = plan({ content: "portions", targets: [target(targetSnapshot)] }, source);
  assert.equal(result.targets[0].next.entries.length, 0);
  assert.equal(result.targets[0].changed, false);
  assert.ok(result.targets[0].exceptions.some(item => item.kind === "no-target-dish"));
});

test("unknown destinations are reported and never copied as guessed OPLOCs", () => {
  const source = sourceWithMonday([{ destinationId: "oploc:retired", destinationLabel: "Retired site", quantity: 5 }, { destinationLabel: "One-off", quantity: 2 }]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:chicken", label: "Chicken Breast" });
  const result = plan({ content: "portions", targets: [target(targetSnapshot)] }, source);
  assert.equal(result.targets[0].next.entries[0].allocations.length, 0);
  assert.ok(result.targets[0].exceptions.some(item => item.kind === "unknown-destination"));
  assert.equal(result.targets[0].changed, false);
});

test("MENU+PORTIONS replaces target allocations on replace and skips them on fill-empty", () => {
  const source = sourceWithMonday([{ destinationId: OPLOC_A, destinationLabel: "Site A", quantity: 10 }]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:chicken", label: "Chicken Breast" }, [{ destinationId: OPLOC_B, destinationLabel: "Site B", quantity: 3 }]);
  const replaced = plan({ content: "menu-and-portions", existing: "replace", targets: [target(targetSnapshot)] }, source).targets[0].next.entries[0];
  assert.deepEqual(replaced.allocations.map(allocation => [allocation.destinationId, allocation.quantity]), [[OPLOC_A, 10]]);
  const filled = plan({ content: "menu-and-portions", existing: "fill-empty", targets: [target(targetSnapshot)] }, source);
  assert.deepEqual(filled.targets[0].next.entries[0].allocations.map(allocation => [allocation.destinationId, allocation.quantity]), [[OPLOC_B, 3]]);
  assert.ok(filled.targets[0].exceptions.some(item => item.kind === "occupied"));
});

test("published target days are protected and never written", () => {
  const source = sourceWithMonday();
  const targetSnapshot = week("2026-11-09");
  const result = plan({ content: "menu-and-portions", targets: [target(targetSnapshot, { protectedDayIds: new Set([targetSnapshot.days[0].id]) })] }, source);
  assert.equal(result.targets[0].next.entries.length, 0);
  assert.equal(result.targets[0].changed, false);
  assert.ok(result.targets[0].exceptions.some(item => item.kind === "published"));
});

test("a same-week copy to the same weekday is rejected as a no-op", () => {
  const source = sourceWithMonday();
  const result = plan({ content: "menu", targets: [target(source)] }, source);
  assert.ok(result.targets[0].exceptions.every(item => item.kind === "same-day"));
  assert.equal(result.targets[0].changed, false);
});

test("a single-day copy can place one source day onto another weekday of the same week", () => {
  const source = sourceWithMonday();
  const result = plan({ scope: { kind: "days", dayIndexes: [0] }, content: "menu", targets: [target(source, { placement: { kind: "day", dayIndex: 3 } })] }, source);
  const thursday = result.targets[0].next.entries.find(item => item.dayId === result.targets[0].next.days[3].id);
  assert.equal(thursday?.itemId, "dish:chicken");
});

test("multiple weekday placements are rejected when mapping onto one destination day", () => {
  const source = sourceWithMonday();
  assert.throws(() => plan({ scope: { kind: "days", dayIndexes: [0, 1] }, content: "menu", targets: [target(week("2026-11-09"), { placement: { kind: "day", dayIndex: 3 } })] }, source), /single destination day/);
});

test("custom governed rows are added to the target week when missing, but removed rows are not restored", () => {
  const source = week("2026-11-02", ["COLD PROTEIN"], ["SALAD 1"]);
  entry(source, 0, "SALAD 1", { id: "dish:salad", label: "Green Salad" });
  const addTarget = week("2026-11-09", ["COLD PROTEIN"], []);
  const added = plan({ content: "menu", targets: [target(addTarget)] }, source).targets[0];
  assert.deepEqual(added.rowsAdded, ["SALAD 1"]);
  assert.deepEqual(added.next.week.customSlots, ["SALAD 1"]);
  const removedTarget = week("2026-11-09", ["COLD PROTEIN"], []);
  removedTarget.week.removedSlots = ["SALAD 1"];
  const removed = plan({ content: "menu", targets: [target(removedTarget)] }, source).targets[0];
  assert.equal(removed.rowsAdded.length, 0);
  assert.ok(removed.exceptions.some(item => item.kind === "no-target-row"));
});

test("a dish that is not compatible with the target slot is reported", () => {
  const source = week("2026-11-02");
  entry(source, 0, "SOUP", { id: "dish:chicken", label: "Chicken Breast" });
  const result = plan({ content: "menu", targets: [target(week("2026-11-09"))] }, source).targets[0];
  assert.ok(result.exceptions.some(item => item.kind === "incompatible-dish"));
});

test("a dish missing from the Dish Library is reported and not copied", () => {
  const source = week("2026-11-02");
  entry(source, 0, "COLD PROTEIN", { id: "dish:unknown", label: "Unknown" });
  const result = plan({ content: "menu", targets: [target(week("2026-11-09"))] }, source).targets[0];
  assert.ok(result.exceptions.some(item => item.kind === "unknown-dish"));
  assert.equal(result.changed, false);
});

test("a dish change revokes an allergen review copied from the prior dish", () => {
  const source = sourceWithMonday([]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", { id: "dish:beef", label: "Beef" });
  const target0 = targetSnapshot.entries[0];
  target0.allergenReview = { reviewedBy: "reviewer@fika", reviewedAt: "2026-10-20T10:00:00.000Z" } as unknown as RollingEntry["allergenReview"];
  const updated = plan({ content: "menu", existing: "replace", targets: [target(targetSnapshot)] }, source).targets[0].next.entries[0];
  assert.equal(updated.itemLabel, "Chicken Breast");
  assert.equal(updated.allergenReview, undefined);
  assert.equal(updated.allergenReviewInvalidated, true);
});

test("repeating an applied operation writes nothing and creates no duplicate entries", () => {
  const source = sourceWithMonday([{ destinationId: OPLOC_A, destinationLabel: "Site A", quantity: 10 }]);
  const first = plan({ content: "menu-and-portions", targets: [target(week("2026-11-09"))] }, source).targets[0];
  assert.equal(first.next.entries.length, 1);
  const applied = plan({ content: "menu-and-portions", targets: [target(first.next, { alreadyApplied: true })] }, source).targets[0];
  assert.equal(applied.changed, false);
  assert.equal(applied.next.entries.length, 1);
  assert.ok(applied.exceptions.some(item => item.kind === "already-applied"));
  // Re-running on the already-copied state with a fresh operation is also a no-op for identical content.
  const rerun = plan({ content: "menu-and-portions", operationId: "op-test-0002", targets: [target(first.next)] }, source).targets[0];
  assert.equal(rerun.next.entries.length, 1);
  assert.equal(rerun.changed, false);
});

test("multiple destination weeks are planned independently with their own expected versions", () => {
  const source = sourceWithMonday();
  const nextWeek = week("2026-11-09", undefined, undefined, 5);
  const weekAfter = week("2026-11-16", undefined, undefined, 8);
  const result = plan({ content: "menu", targets: [target(nextWeek), target(weekAfter)] }, source);
  assert.deepEqual(result.targets.map(item => item.expectedVersion), [5, 8]);
  assert.equal(result.totals.targets, 2);
  assert.equal(result.targets[1].next.week.version, 9);
});

test("source Monday copied into Tuesday of the same week with a different slot does not alter Monday", () => {
  const source = sourceWithMonday();
  const sourceBefore = JSON.stringify(source);
  plan({ scope: { kind: "days", dayIndexes: [0] }, content: "menu", targets: [target(source, { placement: { kind: "day", dayIndex: 1 } })] }, source);
  assert.equal(JSON.stringify(source), sourceBefore);
});

test("MENU onto a blank target that already holds quantities reports them as a change", () => {
  const source = sourceWithMonday([]);
  const targetSnapshot = week("2026-11-09");
  entry(targetSnapshot, 0, "COLD PROTEIN", undefined, [{ destinationId: OPLOC_B, destinationLabel: "Site B", quantity: 2 }]);
  const result = plan({ content: "menu", existing: "replace", targets: [target(targetSnapshot)] }, source).targets[0];
  assert.equal(result.overwrites.length, 1);
  assert.equal(result.overwrites[0].fromDish, "blank");
  assert.equal(result.overwrites[0].toDish, "Chicken Breast");
  assert.equal(result.overwrites[0].retainedAllocationRows, 1);
});
