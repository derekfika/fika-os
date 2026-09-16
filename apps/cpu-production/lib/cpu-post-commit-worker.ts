import type { NextRequest } from "next/server";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { buildCpuPropagationEvents, deliverCpuPropagation } from "./cpu-durable-outbox";
import { loadPlansForOrders } from "./cpu-projection-repository";
import { latestCpuChangeSequence, rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "./cpu-projection";
import { productionQueue } from "./production-http-client";
import { rebuildCpuReviewPackage } from "./cpu-review-package";

export type CpuPostCommitJob = { action: "master-sign"; commandId: string; serviceDate: string; orderIds: string[] };

/**
 * Process the durable post-commit job created by master signing. The job is
 * intentionally bounded to one service date and its submitted order set.
 * Re-running it only replays stable outbox identities and monotonic rebuilds.
 */
export async function processCpuPostCommitJob(request: NextRequest, job: CpuPostCommitJob) {
  const startedAt = Date.now();
  const orders = (await productionQueue(request, job.serviceDate)).filter(order => job.orderIds.includes(order.canonicalId) && order.origin === "menu_planning" && !order.supersededBy && (order.serviceDate || order.requiredBy.slice(0, 10)) === job.serviceDate);
  const sourceSequence = await latestCpuChangeSequence(job.serviceDate);
  const week = weekCommencingFor(job.serviceDate);
  const weekSourceSequence = Math.max(sourceSequence, ...await Promise.all(Array.from({ length: 5 }, (_, index) => {
    const date = new Date(`${week}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return latestCpuChangeSequence(date.toISOString().slice(0, 10));
  })));
  const timings = { projectionRebuildMs: 0, reviewPackageRebuildMs: 0, deliveryMs: 0 };

  let stageStartedAt = Date.now();
  await rebuildCpuDayProjection(request, job.serviceDate, sourceSequence);
  await rebuildCpuWeekProjection(request, week, weekSourceSequence);
  timings.projectionRebuildMs = Date.now() - stageStartedAt;

  const oplocIds = [...new Set(orders.map(order => order.destinationOplocId).filter((value): value is string => Boolean(value)))];
  stageStartedAt = Date.now();
  for (const oplocId of oplocIds) await rebuildCpuReviewPackage(request, job.serviceDate, oplocId, sourceSequence);
  timings.reviewPackageRebuildMs = Date.now() - stageStartedAt;

  const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
  const planByOrderId = new Map(plans.map(plan => [plan.orderId, plan]));
  const deliveryIds = orders.flatMap(order => {
    const sourceEventId = `cpu-master-sign:${job.commandId}:${order.canonicalId}`;
    const propagationIds = buildCpuPropagationEvents({ eventId: sourceEventId, sourceEntityId: `production-plan:${order.canonicalId}`, serviceDate: job.serviceDate, sourceVersion: sourceSequence, changedAt: new Date().toISOString(), changeType: "amended", order, logistics: false }).map(event => event.eventId);
    const plan = planByOrderId.get(order.canonicalId);
    const release = plan?.currentAllergenRelease;
    const materializationId = release && ["pending", "current"].includes(release.status) && release.materializationStatus !== "ready" ? releaseMaterializationDelivery(plan, release, order, new Date().toISOString()).eventId : undefined;
    return [...propagationIds, ...(materializationId ? [materializationId] : [])];
  });
  stageStartedAt = Date.now();
  const deliveryResults = await Promise.all(deliveryIds.map(eventId => deliverCpuPropagation(eventId)));
  timings.deliveryMs = Date.now() - stageStartedAt;
  const failedDeliveries = deliveryResults.filter(result => result.status !== "delivered").length;
  const result = { status: failedDeliveries ? "partial" as const : "processed" as const, commandId: job.commandId, serviceDate: job.serviceDate, orderCount: orders.length, oplocCount: oplocIds.length, deliveryCount: deliveryIds.length, failedDeliveries, timings: { ...timings, totalMs: Date.now() - startedAt } };
  console.info("FIKA CPU post-commit worker completed", result);
  if (failedDeliveries) throw Object.assign(new Error("One or more CPU post-commit deliveries remain retryable."), { status: 502, code: "CPU_POST_COMMIT_DELIVERY_PENDING" });
  return result;
}
