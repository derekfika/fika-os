import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resumeCpuMaterializationPhase } from "../lib/cpu-release-materialization";
import { createProductionPlanRepository, revisionForWrite } from "../lib/production-plan-repository";
import { LEGACY_PLAN_REVISION, planRevisionToken } from "../app/lib/production-plan-state";
import type { ProductionPlan } from "../app/lib/production-plan";

process.env.FIKA_CPU_PLAN_STORE = "memory"; // in-memory repository: no Firestore, no network

const T = "2026-10-18T10:00:00.000Z";
const plan = (orderId: string, notes: string, updatedAt: string | null = T): ProductionPlan => ({ id: `production-plan:${orderId}`, orderId, status: "planning", menuItems: [], planningNotes: notes, updatedBy: "test", audit: [], ...(updatedAt ? { updatedAt } : {}) } as ProductionPlan);
const change = (orderId: string, key: string) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: `production-plan:${orderId}`, changeType: "test", actorId: "test", changedAt: T, idempotencyKey: key });
const conflict = (error: unknown) => (error as { status?: number }).status === 409;

test("a changed plan can never keep revision T, even when the caller re-stamps it with T", async () => {
  const repository = createProductionPlanRepository();
  const first = await repository.save(plan("rev-1", "A"), null);
  assert.equal(first.revision, T);
  const second = await repository.save(plan("rev-1", "B", T), first.revision);
  assert.notEqual(second.revision, T, "changed content with the same caller stamp gets a new revision");
  assert.ok(Date.parse(second.revision) > Date.parse(T));
  assert.equal((await repository.get("rev-1"))!.updatedAt, second.revision, "the stored revision is the one returned");
  // A stale reviewer who still holds T cannot overwrite the newer evidence — through either write entry point.
  await assert.rejects(repository.save(plan("rev-1", "stale", T), T), conflict);
  await assert.rejects(repository.saveAndAppendCpuChange(plan("rev-1", "stale2", T), T, change("rev-1", "stale-key")), conflict);
  assert.equal((await repository.get("rev-1"))!.planningNotes, "B");
});

test("rapid writes and identical timestamps always produce strictly increasing revisions", async () => {
  const repository = createProductionPlanRepository();
  let revision: string | null = null;
  const seen: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const saved: { revision: string } = index % 2 === 0
      ? await repository.save(plan("rev-rapid", `n${index}`, T), revision)
      : await repository.saveAndAppendCpuChange(plan("rev-rapid", `n${index}`, T), revision, change("rev-rapid", `k${index}`));
    seen.push(saved.revision);
    revision = saved.revision;
  }
  for (let index = 1; index < seen.length; index += 1) assert.ok(Date.parse(seen[index]) > Date.parse(seen[index - 1]), `${seen[index]} > ${seen[index - 1]}`);
  assert.equal(new Set(seen).size, seen.length);
});

test("a caller stamp earlier than the stored revision still advances beyond it (background writers with stale clocks)", async () => {
  const repository = createProductionPlanRepository();
  const base = await repository.save(plan("rev-clock", "A", "2026-10-18T12:00:00.000Z"), null);
  const behind = await repository.save(plan("rev-clock", "B", "2026-10-18T09:00:00.000Z"), base.revision);
  assert.ok(Date.parse(behind.revision) > Date.parse(base.revision));
});

test("an identical re-save is an idempotent no-op that keeps the revision; a change never does", async () => {
  const repository = createProductionPlanRepository();
  const created = await repository.save(plan("rev-noop", "A"), null);
  const repeat = await repository.save(plan("rev-noop", "A", "2026-10-19T00:00:00.000Z"), created.revision);
  assert.equal(repeat.revision, created.revision, "nothing changed, nothing advanced");
  const withEvent = await repository.saveAndAppendCpuChange(plan("rev-noop", "A"), created.revision, change("rev-noop", "noop-key"));
  assert.equal(withEvent.revision, created.revision);
  const changed = await repository.save(plan("rev-noop", "A2"), created.revision);
  assert.notEqual(changed.revision, created.revision);
});

test("first creation and legacy unstamped plans stay protected", async () => {
  const repository = createProductionPlanRepository();
  const created = await repository.save(plan("rev-first", "A"), null);
  await assert.rejects(repository.save(plan("rev-first", "B"), null), conflict, "a second first-create loses");
  assert.ok(created.revision);
  // Legacy: a stored plan with no updatedAt has the fixed token, is stamped on its next guarded save, and cannot be bypassed.
  const legacy = plan("rev-legacy", "legacy", null);
  assert.equal(planRevisionToken(legacy), LEGACY_PLAN_REVISION);
  const stamped = revisionForWrite(plan("rev-legacy", "A", null), legacy, "2026-10-18T10:00:00.000Z");
  assert.equal(stamped.changed, true);
  assert.equal(stamped.revision, "2026-10-18T10:00:00.000Z");
  assert.equal(stamped.persisted.updatedAt, stamped.revision);
  const noBypass = revisionForWrite(plan("rev-legacy", "legacy", "2026-10-18T10:00:00.000Z"), legacy);
  assert.equal(noBypass.changed, false, "identical content keeps the legacy token rather than inventing a revision");
});

test("release materialisation phases and post-commit writers chain from the revision the repository actually saved", async () => {
  const repository = createProductionPlanRepository();
  const base = await repository.save(plan("rev-materialize", "signed"), null);
  // Every phase candidate carries the SAME wall-clock stamp T (as happens when phases run within one millisecond).
  const phase = async (name: "started" | "prepared" | "final", previous: ProductionPlan) => {
    const candidate = structuredClone(previous);
    candidate.updatedAt = T;
    candidate.audit.push({ action: `allergen-matrix-${name}`, at: T, by: "worker" } as ProductionPlan["audit"][number]);
    const result = await repository.saveAndAppendCpuChange(candidate, planRevisionToken(previous), change("rev-materialize", `phase-${name}`));
    return { result, plan: resumeCpuMaterializationPhase(result, candidate, name) };
  };
  const started = await phase("started", (await repository.get("rev-materialize"))!);
  const prepared = await phase("prepared", started.plan);
  const final = await phase("final", prepared.plan);
  const revisions = [base.revision, started.result.revision, prepared.result.revision, final.result.revision];
  for (let index = 1; index < revisions.length; index += 1) assert.ok(Date.parse(revisions[index]) > Date.parse(revisions[index - 1]));
  assert.equal(final.plan.updatedAt, final.result.revision, "the chained plan carries the saved revision");
  assert.equal((await repository.get("rev-materialize"))!.updatedAt, final.result.revision);
  // A reviewer who loaded the pre-materialisation revision can no longer overwrite the released evidence.
  await assert.rejects(repository.save(plan("rev-materialize", "stale reviewer", T), base.revision), conflict);
  assert.equal((await repository.get("rev-materialize"))!.audit.length, 3);
});

test("every repository caller propagates the saved revision rather than a caller timestamp", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const worker = read("../lib/cpu-post-commit-worker.ts");
  assert.match(worker, /saveAndAppendCpuChange\(candidate, planRevisionToken\(plan\)/);
  assert.match(worker, /candidate\.updatedAt = result\.revision/);
  const materialization = read("../lib/cpu-release-materialization.ts");
  assert.doesNotMatch(materialization, /saveAndAppendCpuChange\([^)]*\.updatedAt/);
  assert.match(materialization, /localCandidate\.updatedAt = result\.revision/);
  assert.match(materialization, /repository\.save\(failed, planRevisionToken\(current\)\)/);
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /plan\.updatedAt = saved\.revision/);
  assert.match(route, /item\.plan\.updatedAt = event\.revision/);
  assert.doesNotMatch(route, /updatedAt: new Date|expectedUpdatedAt/);
});
