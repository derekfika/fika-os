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
const { emptyWeek, getWeek, listWeeks, planningWeekCommencing, saveSnapshot } = await import("../lib/rolling-menu");

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

const twoDestinations = (secondWeek: string) => [{ weekCommencing: TARGET_WC, placement: { kind: "corresponding" as const } }, { weekCommencing: secondWeek, placement: { kind: "corresponding" as const } }];
const secondWeekCommencing = () => planningWeekCommencing(`${2080 + seedRun}-03-19`);

test("a missing, empty or non-string actor is rejected for every destination before any write", async () => {
  const { source, target } = await seed();
  const second = secondWeekCommencing();
  const request = { ...baseRequest(source.week.id, "dup-actor-0001"), destinations: twoDestinations(second) };
  for (const actor of [undefined, "", "   ", null, 42] as unknown[]) {
    for (const mode of ["preview", "apply"] as const) {
      await assert.rejects(duplicateMenuPlanning({ ...request, mode, planHash: "0".repeat(64), expectedVersions: { [TARGET_WC]: 1 } }, actor as string, LIVE_OPLOCS), (error: { status?: number }) => error.status === 401);
    }
  }
  assert.equal((await getWeek(target.week.id)).entries.length, 0);
  assert.equal((await listWeeks()).some(week => week.weekCommencing === second), false);
});

test("a destination week carrying an audit element without an actor is refused before any destination is written", async () => {
  const { source, target } = await seed();
  const second = secondWeekCommencing();
  const secondWeek = emptyWeek(second, "duplicate-test");
  // A legacy/corrupt element: no recorded actor. It must be reported, never repaired or invented.
  (secondWeek.week.audit as unknown[]).push({ action: "legacy-edit", at: "2026-01-01T00:00:00.000Z" });
  await saveSnapshot(secondWeek);
  const request = { ...baseRequest(source.week.id, "dup-corrupt-0001"), destinations: twoDestinations(second) };
  const preview = await duplicateMenuPlanning(request, "tester@fika", LIVE_OPLOCS);
  await assert.rejects(
    duplicateMenuPlanning({ ...request, mode: "apply", planHash: preview.planHash, expectedVersions: { [TARGET_WC]: 1, [second]: 1 } }, "tester@fika", LIVE_OPLOCS),
    (error: { status?: number; message?: string }) => error.status === 409 && /audit entry without a recorded actor/.test(error.message || ""),
  );
  assert.equal((await getWeek(target.week.id)).entries.length, 0);
  assert.equal((await getWeek(target.week.id)).week.version, 1);
  const untouched = await getWeek(secondWeek.week.id);
  assert.equal(untouched.week.version, 1);
  assert.equal((untouched.week.audit[1] as { by?: string }).by, undefined);
});

test("multi-destination apply succeeds once; retry after a partial apply skips the applied week and keeps its quantities and version", async () => {
  const { dish, source, target } = await seed();
  const second = secondWeekCommencing();
  const request = { ...baseRequest(source.week.id, "dup-retry-0001"), destinations: twoDestinations(second) };
  const preview = await duplicateMenuPlanning(request, "tester@fika", LIVE_OPLOCS);
  assert.deepEqual(Object.keys(preview.targetHashes).sort(), [TARGET_WC, second].sort());

  // Reproduce the state a failure on the second destination leaves: only the first was saved.
  const firstOnly = { ...request, destinations: [request.destinations[0]] };
  const firstPreview = await duplicateMenuPlanning(firstOnly, "tester@fika", LIVE_OPLOCS);
  await duplicateMenuPlanning({ ...firstOnly, mode: "apply", planHash: firstPreview.planHash, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS);
  assert.equal((await getWeek(target.week.id)).week.version, 2);

  // The reviewer presses Copy again with the original preview: no stale-hash or version conflict.
  const retryRequest = { ...request, mode: "apply" as const, planHash: preview.planHash, targetHashes: preview.targetHashes, expectedVersions: { [TARGET_WC]: 1 } };
  const retry = await duplicateMenuPlanning(retryRequest, "tester@fika", LIVE_OPLOCS);
  assert.equal(retry.mode === "apply" ? retry.applied.map(item => item.weekCommencing).join() : "", second);
  const firstFinal = await getWeek(target.week.id);
  assert.equal(firstFinal.week.version, 2, "applied week is not written again");
  assert.equal(firstFinal.entries.length, 1);
  assert.deepEqual(firstFinal.entries[0].allocations.map(allocation => allocation.quantity), [4]);
  assert.equal(firstFinal.week.audit.filter(event => event.action === "duplicate-plan:dup-retry-0001").length, 1);
  const secondWeek = (await listWeeks()).find(week => week.weekCommencing === second)!;
  const secondFinal = await getWeek(secondWeek.id);
  assert.equal(secondFinal.entries[0].itemId, dish.canonicalId);
  assert.deepEqual(secondFinal.entries[0].allocations.map(allocation => allocation.quantity), [4]);
  assert.ok(secondFinal.week.audit.every(event => typeof event.by === "string" && event.by));

  // A further press changes nothing.
  const again = await duplicateMenuPlanning(retryRequest, "tester@fika", LIVE_OPLOCS);
  assert.equal(again.mode === "apply" ? again.applied.length : -1, 0);
});

test("a partial-apply retry refuses when the reviewed per-destination digests are missing", async () => {
  const { source, target } = await seed();
  const second = secondWeekCommencing();
  const request = { ...baseRequest(source.week.id, "dup-retry-0002"), destinations: twoDestinations(second) };
  const preview = await duplicateMenuPlanning(request, "tester@fika", LIVE_OPLOCS);
  const firstOnly = { ...request, destinations: [request.destinations[0]] };
  const firstPreview = await duplicateMenuPlanning(firstOnly, "tester@fika", LIVE_OPLOCS);
  await duplicateMenuPlanning({ ...firstOnly, mode: "apply", planHash: firstPreview.planHash, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS);
  await assert.rejects(duplicateMenuPlanning({ ...request, mode: "apply", planHash: preview.planHash, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS), (error: { status?: number }) => error.status === 409);
  await assert.rejects(duplicateMenuPlanning({ ...request, mode: "apply", planHash: preview.planHash, targetHashes: { ...preview.targetHashes, [second]: "0".repeat(64) }, expectedVersions: { [TARGET_WC]: 1 } }, "tester@fika", LIVE_OPLOCS), (error: { status?: number }) => error.status === 409);
  assert.equal((await listWeeks()).some(week => week.weekCommencing === second), false);
  assert.equal((await getWeek(target.week.id)).week.version, 2);
});

test("published destination days stay protected on apply", async () => {
  const { source, target } = await seed();
  const published = await getWeek(target.week.id);
  published.week.status = "published";
  published.week.dayStatuses = Object.fromEntries(published.days.map(day => [day.id, "published"]));
  published.week.version = 2;
  await saveSnapshot(published, 1);
  const preview = await duplicateMenuPlanning(baseRequest(source.week.id, "dup-published-01"), "tester@fika", LIVE_OPLOCS);
  assert.ok(preview.plan.targets[0].exceptions.some(item => item.kind === "published"));
  await duplicateMenuPlanning({ ...baseRequest(source.week.id, "dup-published-01", { mode: "apply" }), planHash: preview.planHash, expectedVersions: { [TARGET_WC]: 2 } }, "tester@fika", LIVE_OPLOCS);
  const after = await getWeek(target.week.id);
  assert.equal(after.entries.length, 0);
  assert.equal(after.week.version, 2);
});
