import type { NextRequest } from "next/server";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { buildCpuPropagationEvents, deliverCpuPropagation } from "./cpu-durable-outbox";
import { loadPlansForOrders } from "./cpu-projection-repository";
import { latestCpuChangeSequence, rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "./cpu-projection";
import { productionQueue } from "./production-http-client";
import { rebuildCpuReviewPackage } from "./cpu-review-package";
import { createCpuMasterArtifact } from "./cpu-release-materialization";
import { createProductionPlanRepository } from "./production-plan-repository";
import { committedAllergenReleaseMatchesOrder, matrixSignatureScope, signatureMatchesScope, type MatrixArtifact, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash } from "./cpu-allergen-release";
import { planRevisionToken } from "../app/lib/production-plan-state";
import { cpuMasterReviewId, cpuMasterReviewSemanticHash, saveCpuMasterReview, type CpuMasterReviewMember } from "./cpu-master-review";
import { isCpuWithdrawn } from "./production-presentation";
import type { ProductionOrder } from "./production-types";

export type CpuPostCommitJob = { action: "master-sign"; commandId: string; serviceDate: string; orderIds: string[] };
export const CPU_POST_COMMIT_CONCURRENCY = 4;

export type CpuPostCommitDependencies = {
  productionQueue?: typeof productionQueue;
  loadPlansForOrders?: typeof loadPlansForOrders;
  saveCpuMasterReview?: typeof saveCpuMasterReview;
};

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function memberFor(order: ProductionOrder, plan: ProductionPlan | undefined): CpuMasterReviewMember {
  const scope = plan && matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems));
  return { orderId: order.canonicalId, sourceDayId: scope?.sourceDayId, sourcePublicationId: scope?.sourcePublicationId, sourcePublicationDayId: scope?.sourcePublicationDayId, sourceVersion: scope?.sourceVersion, sourceContentHash: scope?.sourceContentHash, matrixContentHash: scope?.matrixContentHash };
}

type CpuMasterSigningPlan = { order: ProductionOrder; plan: ProductionPlan };

/** Frozen release evidence alone can authorize a date-wide signed master. */
export function cpuMasterSignatureAuthority(orders: ProductionOrder[], planByOrderId: Map<string, ProductionPlan>) {
  const members = orders.map(order => memberFor(order, planByOrderId.get(order.canonicalId)));
  const eligiblePlans = orders.flatMap((order): CpuMasterSigningPlan[] => {
    const plan = planByOrderId.get(order.canonicalId);
    const release = plan?.currentAllergenRelease;
    if (!plan || !release || !["pending", "current"].includes(release.status) || !committedAllergenReleaseMatchesOrder(release, order, plan.menuItems)) return [];
    return [{ order, plan }];
  });
  const invalidOrderIds = orders.flatMap(order => {
    const plan = planByOrderId.get(order.canonicalId);
    if (!plan) return [order.canonicalId];
    const release = plan.currentAllergenRelease;
    if (release && !eligiblePlans.some(item => item.order.canonicalId === order.canonicalId)) return [order.canonicalId];
    if (!release) {
      const scope = matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems));
      const roles = new Set((plan.signatures || []).filter(signature => scope && signatureMatchesScope(signature, scope)).map(signature => signature.role));
      if (roles.has("production_chef") && roles.has("head_chef_site_manager")) return [order.canonicalId];
    }
    return [];
  });
  const signaturesComplete = orders.length > 0 && eligiblePlans.length === orders.length;
  const signatureRoles = Object.fromEntries(orders.map(order => {
    const plan = planByOrderId.get(order.canonicalId);
    const release = plan?.currentAllergenRelease;
    const scope = plan && matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems));
    const signatures = release
      ? eligiblePlans.some(item => item.order.canonicalId === order.canonicalId) ? release.signatures : []
      : plan?.signatures?.filter(signature => scope && signatureMatchesScope(signature, scope)) || [];
    return [order.canonicalId, [...new Set(signatures.map(signature => signature.role))]];
  }));
  return { members, signatureRoles, signaturesComplete, invalidOrderIds, signedPlans: signaturesComplete ? eligiblePlans : [] };
}

export function cpuPostCommitRosterMatchesJob(orders: ProductionOrder[], requestedOrderIds: string[]) {
  if (!Array.isArray(requestedOrderIds) || requestedOrderIds.length < 1 || requestedOrderIds.length > 200) return false;
  if (requestedOrderIds.some(id => typeof id !== "string" || !id.trim())) return false;
  const requested = [...requestedOrderIds].sort();
  const current = orders.map(order => order.canonicalId).sort();
  return new Set(requested).size === requested.length && new Set(current).size === current.length
    && requested.length === current.length && requested.every((id, index) => id === current[index]);
}

function postCommitConflict(message: string) {
  return Object.assign(new Error(message), { status: 409, code: "CPU_MASTER_REVIEW_LINEAGE_CONFLICT" });
}

/** Critical release work starts before derived projection housekeeping. */
export async function processCpuPostCommitJob(request: NextRequest, job: CpuPostCommitJob, dependencies: CpuPostCommitDependencies = {}) {
  const startedAt = Date.now();
  const serviceDateOrders = (await (dependencies.productionQueue || productionQueue)(request, job.serviceDate)).filter(order => order.origin === "menu_planning" && !isCpuWithdrawn(order) && (order.serviceDate || order.requiredBy.slice(0, 10)) === job.serviceDate);
  if (!cpuPostCommitRosterMatchesJob(serviceDateOrders, job.orderIds)) throw postCommitConflict("The CPU master-sign order roster changed after signing; reload and review every active Menu order for this service date.");
  const orders = serviceDateOrders;
  const plans = await (dependencies.loadPlansForOrders || loadPlansForOrders)(orders.map(order => order.canonicalId));
  const planByOrderId = new Map(plans.map(plan => [plan.orderId, plan]));
  const authority = cpuMasterSignatureAuthority(orders, planByOrderId);
  const { members, signatureRoles, signaturesComplete: releasesComplete, invalidOrderIds } = authority;
  const masterReviewId = cpuMasterReviewId({ serviceDate: job.serviceDate, members });
  if (orders.some(order => planByOrderId.get(order.canonicalId)?.masterReviewId !== masterReviewId)) throw postCommitConflict("The CPU master review identity no longer matches its committed order and matrix lineage.");
  if (invalidOrderIds.length) throw postCommitConflict("A CPU master member has incomplete or invalid frozen signature evidence; no master artifact or release delivery was started.");
  const signaturesComplete = releasesComplete;
  const signedPlans = signaturesComplete ? authority.signedPlans : [];
  const queuedAt = new Date(startedAt).toISOString();
  const updateReview = (state: "queued" | "running" | "completed" | "failed", timestamps: { queuedAt?: string; startedAt?: string; completedAt?: string }) => (dependencies.saveCpuMasterReview || saveCpuMasterReview)({ id: masterReviewId, serviceDate: job.serviceDate, commandId: job.commandId, orderIds: orders.map(order => order.canonicalId).sort(), expectedLineages: Object.fromEntries(members.map(member => [member.orderId, member])), semanticMatrixHash: cpuMasterReviewSemanticHash(members), signatureRoles, status: signaturesComplete ? "signed" : "pending", updatedAt: new Date().toISOString(), updatedBy: "cpu-post-commit-worker", finalization: { state, ...timestamps, updatedAt: new Date().toISOString() } });
  await updateReview("queued", { queuedAt });
  await updateReview("running", { queuedAt, startedAt: new Date().toISOString() });

  try {
  let sharedMaster: MatrixArtifact | undefined;
  const existingMasters = signedPlans.map(({ plan }) => plan.masterMatrixArtifact).filter((artifact): artifact is MatrixArtifact => Boolean(artifact?.pdfStatus === "generated" && artifact.driveStatus === "saved" && artifact.driveFileId && artifact.contentHash));
  if (existingMasters.length === signedPlans.length && existingMasters.every(artifact => artifact.driveFileId === existingMasters[0]?.driveFileId && artifact.contentHash === existingMasters[0]?.contentHash)) sharedMaster = existingMasters[0];
  if (!sharedMaster && signedPlans.length) {
    const [masterOrder, masterPlan] = [signedPlans[0].order, signedPlans[0].plan];
    const masterItems: PlannedMenuItem[] = signedPlans.flatMap(({ order, plan }) => plan.menuItems.map(item => ({ ...item, id: `${order.canonicalId}:${item.id}`, name: `${order.destinationLabel || order.destinationOplocId || "OPLOC"} · ${item.name}` })));
    sharedMaster = await createCpuMasterArtifact(masterPlan, masterOrder, masterPlan.updatedBy, new Date().toISOString(), request, masterItems);
  }
  if (sharedMaster && signedPlans.length) {
    const repository = createProductionPlanRepository();
    await mapWithConcurrency(signedPlans, CPU_POST_COMMIT_CONCURRENCY, async ({ order, plan }) => {
      if (plan.masterMatrixArtifact?.driveFileId === sharedMaster!.driveFileId && plan.masterMatrixArtifact?.contentHash === sharedMaster!.contentHash && plan.currentAllergenRelease?.masterArtifact?.driveFileId === sharedMaster!.driveFileId) return;
      const candidate = structuredClone(plan);
      candidate.masterMatrixArtifact = sharedMaster;
      if (candidate.currentAllergenRelease) candidate.currentAllergenRelease.masterArtifact = sharedMaster!;
      candidate.updatedAt = new Date().toISOString();
      candidate.audit.push({ action: "allergen-master-artifact-shared", at: candidate.updatedAt, by: candidate.updatedBy, reason: `One service-date master PDF is reused for OPLOC release ${candidate.currentAllergenRelease?.releaseId || "pending"}.` });
      const result = await repository.saveAndAppendCpuChange(candidate, planRevisionToken(plan), { serviceDate: job.serviceDate, entityType: "productionPlan", entityId: candidate.id, revision: candidate.audit.length, changeType: "allergen-master-artifact-shared", actorId: candidate.updatedBy, changedAt: candidate.updatedAt, idempotencyKey: `cpu-master-artifact:${masterReviewId}:${order.canonicalId}` });
      candidate.updatedAt = result.revision;
      planByOrderId.set(order.canonicalId, result.plan || candidate);
    });
  }

  const sourceSequence = await latestCpuChangeSequence(job.serviceDate);
  const week = weekCommencingFor(job.serviceDate);
  const weekSourceSequence = Math.max(sourceSequence, ...await Promise.all(Array.from({ length: 5 }, (_, index) => { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); return latestCpuChangeSequence(date.toISOString().slice(0, 10)); })));
  const materializationIds = signaturesComplete ? orders.flatMap(order => { const plan = planByOrderId.get(order.canonicalId); const release = plan?.currentAllergenRelease; return plan && release && ["pending", "current"].includes(release.status) && committedAllergenReleaseMatchesOrder(release, order, plan.menuItems) && release.materializationStatus !== "ready" ? [releaseMaterializationDelivery(plan, release, order, new Date().toISOString()).eventId] : []; }) : [];
  const materializationStartedAt = Date.now();
  const materializationWork = mapWithConcurrency(materializationIds, CPU_POST_COMMIT_CONCURRENCY, eventId => deliverCpuPropagation(eventId));

  const housekeepingStartedAt = Date.now();
  const projectionWork = Promise.all([rebuildCpuDayProjection(request, job.serviceDate, sourceSequence), rebuildCpuWeekProjection(request, week, weekSourceSequence)]);
  const oplocIds = [...new Set(orders.filter(order => order.destination?.kind !== "one-off" && !order.destinationOplocId?.includes(":one-off:")).map(order => order.destinationOplocId).filter((value): value is string => Boolean(value)))];
  const reviewWork = mapWithConcurrency(oplocIds, CPU_POST_COMMIT_CONCURRENCY, oplocId => rebuildCpuReviewPackage(request, job.serviceDate, oplocId, sourceSequence));
  await Promise.all([projectionWork, reviewWork]);
  const housekeepingMs = Date.now() - housekeepingStartedAt;
  const materializationResults = await materializationWork;
  const propagationIds = orders.flatMap(order => buildCpuPropagationEvents({ eventId: `cpu-master-sign:${job.commandId}:${order.canonicalId}`, sourceEntityId: `production-plan:${order.canonicalId}`, serviceDate: job.serviceDate, sourceVersion: sourceSequence, changedAt: new Date().toISOString(), changeType: "amended", order, logistics: false }).map(event => event.eventId));
  const propagationResults = await mapWithConcurrency(propagationIds, CPU_POST_COMMIT_CONCURRENCY, eventId => deliverCpuPropagation(eventId));
  const deliveryResults = [...materializationResults, ...propagationResults];
  const failedDeliveries = deliveryResults.filter(result => result.status !== "delivered").length;
  await updateReview(failedDeliveries ? "failed" : "completed", { queuedAt, startedAt: queuedAt, ...(failedDeliveries ? {} : { completedAt: new Date().toISOString() }) });
  const result = { status: failedDeliveries ? "partial" as const : "processed" as const, commandId: job.commandId, masterReviewId, serviceDate: job.serviceDate, orderCount: orders.length, oplocCount: oplocIds.length, deliveryCount: deliveryResults.length, failedDeliveries, timings: { materializationStartMs: materializationStartedAt - startedAt, housekeepingMs, deliveryMs: Date.now() - materializationStartedAt, totalMs: Date.now() - startedAt } };
  console.info("FIKA CPU post-commit worker completed", result);
  if (failedDeliveries) throw Object.assign(new Error("One or more CPU post-commit deliveries remain retryable."), { status: 502, code: "CPU_POST_COMMIT_DELIVERY_PENDING" });
  return result;
  } catch (error) {
    await updateReview("failed", { queuedAt, startedAt: queuedAt }).catch(() => undefined);
    throw error;
  }
}
