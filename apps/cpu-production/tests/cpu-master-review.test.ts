import assert from "node:assert/strict";
import test from "node:test";
import { cpuMasterReviewId, cpuMasterReviewSemanticHash, saveCpuMasterReview, getCpuMasterReview, resetCpuMasterReviewsForTests, type CpuMasterReviewMember } from "../lib/cpu-master-review";

const members: CpuMasterReviewMember[] = [
  { orderId: "order:haleon", sourceDayId: "day:1", sourcePublicationDayId: "pub-day:1", sourceVersion: 3, sourceContentHash: "a".repeat(64), matrixContentHash: "b".repeat(64) },
  { orderId: "order:xchange", sourceDayId: "day:1", sourcePublicationDayId: "pub-day:1", sourceVersion: 3, sourceContentHash: "a".repeat(64), matrixContentHash: "c".repeat(64) },
];

test("one exact reviewed service-date matrix has one stable master-review identity", () => {
  const first = cpuMasterReviewId({ serviceDate: "2026-09-14", members });
  const retry = cpuMasterReviewId({ serviceDate: "2026-09-14", members: [...members].reverse() });
  assert.equal(first, retry);
  assert.notEqual(first, cpuMasterReviewId({ serviceDate: "2026-09-14", members: members.map(member => ({ ...member, sourceContentHash: "d".repeat(64) })) }));
  assert.notEqual(first, cpuMasterReviewId({ serviceDate: "2026-09-15", members }));
  assert.notEqual(first, cpuMasterReviewId({ serviceDate: "2026-09-14", members: members.map(member => ({ ...member, matrixContentHash: "e".repeat(64) })) }));
  assert.notEqual(cpuMasterReviewSemanticHash(members), cpuMasterReviewSemanticHash(members.map(member => ({ ...member, matrixContentHash: "e".repeat(64) }))));
});

test("master-review persistence is compact metadata and idempotently updates the same document", async () => {
  const previousStore = process.env.FIKA_CPU_PLAN_STORE;
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  resetCpuMasterReviewsForTests();
  const id = cpuMasterReviewId({ serviceDate: "2026-09-14", members });
  const review = { id, serviceDate: "2026-09-14", commandId: "cpu-master-sign:first", orderIds: members.map(member => member.orderId), expectedLineages: Object.fromEntries(members.map(member => [member.orderId, member])), semanticMatrixHash: cpuMasterReviewSemanticHash(members), signatureRoles: Object.fromEntries(members.map(member => [member.orderId, ["production_chef", "head_chef_site_manager"]])), status: "signed" as const, updatedAt: "2026-09-14T10:00:00Z", updatedBy: "worker", finalization: { state: "completed" as const, queuedAt: "2026-09-14T09:59:00Z", startedAt: "2026-09-14T09:59:01Z", completedAt: "2026-09-14T10:00:00Z", updatedAt: "2026-09-14T10:00:00Z" } };
  try {
    await saveCpuMasterReview(review);
    const stored = await getCpuMasterReview(id);
    assert.deepEqual(stored, review);
    assert.equal(JSON.stringify(stored).includes("signatureDataUrl"), false);
    await saveCpuMasterReview({ ...review, commandId: "cpu-master-sign:retry" });
    assert.equal((await getCpuMasterReview(id))?.commandId, "cpu-master-sign:retry");
  } finally {
    if (previousStore === undefined) delete process.env.FIKA_CPU_PLAN_STORE;
    else process.env.FIKA_CPU_PLAN_STORE = previousStore;
  }
});

test("a completed first-role job does not block the second role or retryable deliveries", async () => {
  const previousStore = process.env.FIKA_CPU_PLAN_STORE;
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  resetCpuMasterReviewsForTests();
  const id = cpuMasterReviewId({ serviceDate: "2026-09-14", members });
  const base = { id, serviceDate: "2026-09-14", orderIds: members.map(member => member.orderId), expectedLineages: Object.fromEntries(members.map(member => [member.orderId, member])), semanticMatrixHash: cpuMasterReviewSemanticHash(members), updatedBy: "worker" };
  const firstRole = { ...base, commandId: "cpu-master-sign:first-role", signatureRoles: Object.fromEntries(members.map(member => [member.orderId, ["production_chef"]])), status: "pending" as const, updatedAt: "2026-09-14T10:00:00Z", finalization: { state: "completed" as const, queuedAt: "2026-09-14T09:59:00Z", completedAt: "2026-09-14T10:00:00Z", updatedAt: "2026-09-14T10:00:00Z" } };
  const secondRole = { ...firstRole, commandId: "cpu-master-sign:second-role", signatureRoles: Object.fromEntries(members.map(member => [member.orderId, ["production_chef", "head_chef_site_manager"]])), status: "signed" as const, updatedAt: "2026-09-14T10:02:00Z", finalization: { state: "queued" as const, queuedAt: "2026-09-14T10:02:00Z", updatedAt: "2026-09-14T10:02:00Z" } };
  try {
    await saveCpuMasterReview(firstRole);
    await saveCpuMasterReview(secondRole);
    await saveCpuMasterReview({ ...secondRole, finalization: { state: "running", queuedAt: "2026-09-14T10:02:00Z", startedAt: "2026-09-14T10:02:01Z", updatedAt: "2026-09-14T10:02:01Z" } });
    await saveCpuMasterReview({ ...secondRole, finalization: { state: "failed", queuedAt: "2026-09-14T10:02:00Z", startedAt: "2026-09-14T10:02:01Z", updatedAt: "2026-09-14T10:02:02Z" } });
    assert.equal((await getCpuMasterReview(id))?.finalization.state, "failed");
    await saveCpuMasterReview({ ...secondRole, finalization: { state: "completed", queuedAt: "2026-09-14T10:02:00Z", startedAt: "2026-09-14T10:02:01Z", completedAt: "2026-09-14T10:03:00Z", updatedAt: "2026-09-14T10:03:00Z" } });
    assert.equal((await getCpuMasterReview(id))?.status, "signed");
    assert.equal((await getCpuMasterReview(id))?.finalization.state, "completed");
    await saveCpuMasterReview({ ...firstRole, commandId: "cpu-master-sign:stale-first-role" });
    assert.equal((await getCpuMasterReview(id))?.commandId, secondRole.commandId, "stale pending state cannot roll a signed review back");
  } finally {
    resetCpuMasterReviewsForTests();
    if (previousStore === undefined) delete process.env.FIKA_CPU_PLAN_STORE;
    else process.env.FIKA_CPU_PLAN_STORE = previousStore;
  }
});
