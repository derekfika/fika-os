// Store-backed integration tests for the authoritative Duplicate Planning command.
// The pure plan rules are covered in menu-duplicate.test.ts; this file proves the
// server-side preview/apply guards: plan-hash review, destination version
// protection, idempotent replay and no writes during preview.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isolatedDatabaseDirectory = mkdtempSync(join(tmpdir(), "fika-menu-duplicate-test-"));
process.env.MENU_PLANNING_DB_PATH = join(isolatedDatabaseDirectory, "operational.sqlite");
process.env.MENU_PLANNING_TEST_MODE = "1";
process.on("exit", () => rmSync(isolatedDatabaseDirectory, { recursive: true, force: true }));

const { createCanonicalMenuItem } = await import("../lib/canonical-menu-repository");
const { duplicateMenuPlanning } = await import("../lib/menu-duplicate-command");
const { emptyWeek, getWeek, planningWeekCommencing, saveSnapshot } = await import("../lib/rolling-menu");

const LIVE_OPLOCS = [{ canonicalId: "oploc:duplicate-site-a", label: "Duplicate Site A" }];
// Each seed uses its own weeks: the store is shared across tests in this file.
let SOURCE_WC = "";
let TARGET_WC = "";
let seedRun = 0;

async function seed() {
  seedRun += 1;
  SOURCE_WC = planningWeekCommencing(`${2080 + seedRun}-03-03`);
  TARGET_WC = planningWeekCommencing(`${2080 + seedRun}-03-12`);
  const dish = await createCanonicalMenuItem({ displayName: `Duplicate dish ${Date.now()}`, category: "Cold Protein", allergenEvidence: [{ allergen: "sesame", value: "contains", source: "test", reviewedBy: "test", reviewedAt: new Date().toISOString() }] }, "test");
  const source = emptyWeek(SOURCE_WC, "duplicate-test");
  const entry = { id: `${source.week.id}:entry:source-monday`, dayId: source.days[0].id, date: source.days[0].date, slot: "COLD PROTEIN", itemId: dish.canonicalId, itemLabel: dish.displayName, portions: 4, allocations: [{ destinationId: LIVE_OPLOCS[0].canonicalId, destinationLabel: LIVE_OPLOCS[0].label, quantity: 4 }], allergens: {}, audit: [] };
  source.entries = [entry];
  source.days[0].entryIds = [entry.id];
  source.week.entryIds = [entry.id];
  await saveSnapshot(source);
  // A destination must exist for an apply-with-version guard to bite.
  const target = emptyWeek(TARGET_WC, "duplicate-test");
  await saveSnapshot(target);
  return { dish, source, target };
}

const baseRequest = (sourceWeekId: string, operationId: string, extra: Record<string, unknown> = {}) => ({
  mode: "preview" as const,
  sourceWeekId,
  scope: { kind: "days" as const, dayIndexes: [0] },
  destinations: [{ weekCommencing: TARGET_WC, placement: { kind: "corresponding" as const } }],
  content: "menu-and-portions" as const,
  existing: "replace" as const,
  operationId,
  ...extra,
});

test("preview computes a reviewable plan without writing to the destination", async () => {
  const { source, target } = await seed();
  const result = await duplicateMenuPlanning(baseRequest(source.week.id, "dup-preview-0001"), "tester@fika", LIVE_OPLOCS);
  assert.equal(result.mode, "preview");
  assert.equal(result.plan.totals.dishesChanged, 1);
  assert.equal(result.plan.totals.allocationRowsWritten, 1);
  assert.match(result.planHash, /^[a-f0-9]{64}$/);
  const after = await getWeek(target.week.id);
  assert.equal(after.week.version, 1);
  assert.equal(after.entries.length, 0);
});

test("apply rejects a plan hash that no longer matches the reviewed preview", async () => {
  const { source, target } = await seed();
  await assert.rejects(
    duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-hash-0001", { mode: "apply" }), planHash: "0".repeat(64), expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS),
    (error: { status?: number }) => error.status === 409,
  );
  assert.equal((await getWeek(target.week.id)).entries.length, 0);
});

test("apply writes the reviewed plan once and a replay of the same operation creates nothing", async () => {
  const { dish, source, target } = await seed();
  const preview = await duplicateMenuPlanning(baseRequest(source.week.id, "dup-apply-0001"), "tester@fika", LIVE_OPLOCS);
  const applied = await duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-apply-0001", { mode: "apply" }), planHash: preview.planHash, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS);
  assert.equal(applied.mode, "apply");
  assert.equal(applied.mode === "apply" ? applied.applied.length : -1, 1);
  const written = await getWeek(target.week.id);
  assert.equal(written.entries.length, 1);
  assert.equal(written.entries[0].itemId, dish.canonicalId);
  assert.deepEqual(written.entries[0].allocations.map(allocation => [allocation.destinationId, allocation.quantity]), [[LIVE_OPLOCS[0].canonicalId, 4]]);
  assert.ok(written.week.audit.some(event => event.action === "duplicate-plan:dup-apply-0001"));

  const replayPreview = await duplicateMenuPlanning(baseRequest(source.week.id, "dup-apply-0001"), "tester@fika", LIVE_OPLOCS);
  assert.ok(replayPreview.plan.targets[0].alreadyApplied);
  const replay = await duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-apply-0001", { mode: "apply" }), planHash: replayPreview.planHash, expectedVersions: { [TARGET_WC]: written.week.version } }, "tester@fika", LIVE_OPLOCS);
  assert.equal(replay.mode === "apply" ? replay.applied.length : -1, 0);
  const afterReplay = await getWeek(target.week.id);
  assert.equal(afterReplay.entries.length, 1);
  assert.equal(afterReplay.week.version, written.week.version);
});

test("apply refuses a destination whose version moved since the preview was reviewed", async () => {
  const { source, target } = await seed();
  const preview = await duplicateMenuPlanning(baseRequest(source.week.id, "dup-version-0001"), "tester@fika", LIVE_OPLOCS);
  // Simulate a concurrent edit on the destination after the reviewer's preview.
  const concurrent = await getWeek(target.week.id);
  concurrent.week.version += 1;
  await saveSnapshot(concurrent, 1);
  await assert.rejects(
    duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-version-0001", { mode: "apply" }), planHash: preview.planHash, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS),
    (error: { status?: number }) => error.status === 409,
  );
  assert.equal((await getWeek(target.week.id)).entries.length, 0);
});

test("invalid requests are rejected before any state is read or written", async () => {
  const { source } = await seed();
  await assert.rejects(duplicateMenuPlanning(baseRequest(source.week.id, "short"), "tester@fika", LIVE_OPLOCS), (error: { status?: number }) => error.status === 422);
  await assert.rejects(duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-invalid-01"), destinations: [] }, "tester@fika", LIVE_OPLOCS), (error: { status?: number }) => error.status === 422);
  await assert.rejects(duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-invalid-02"), content: "everything" as never }, "tester@fika", LIVE_OPLOCS), (error: { status?: number }) => error.status === 422);
});
