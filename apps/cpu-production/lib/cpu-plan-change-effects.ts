import type { NextRequest } from "next/server";
import type { ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "./production-types";
import { rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "./cpu-projection";
import { rebuildCpuReviewPackage } from "./cpu-review-package";
import { eventTypeForConsumers, notifyCpuConsumerInvalidations } from "./cpu-consumer-invalidation";

/** Canonical post-commit effects for one durably committed plan change: projections, review package and consumer invalidation. Idempotent per sequence. */
export async function emitCpuPlanChange(request: NextRequest, input: { order: ProductionOrder; plan: ProductionPlan; sequence: number; changeType: string; at: string }) {
  const serviceDate = input.order.serviceDate || input.order.requiredBy.slice(0, 10);
  await rebuildCpuDayProjection(request, serviceDate, input.sequence);
  await rebuildCpuWeekProjection(request, weekCommencingFor(serviceDate), input.sequence);
  const review = input.order.destinationOplocId ? await rebuildCpuReviewPackage(request, serviceDate, input.order.destinationOplocId, input.sequence) : undefined;
  await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${input.plan.id}:v${input.sequence}`, sourceEntityId: input.plan.id, serviceDate, sourceVersion: input.sequence, changedAt: input.at, changeType: eventTypeForConsumers(input.changeType), order: input.order, logistics: false, ...(review ? { reviewManifest: review.manifest } : {}) });
}
