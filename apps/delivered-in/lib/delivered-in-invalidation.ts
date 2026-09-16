import type { NextRequest } from "next/server";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { markDeliveredInProjectionStale, type DeliveredInInvalidation } from "./delivered-in-projection-store";
import { reconcileDeliveredInDay, type DeliveredInReconciliationContext } from "./delivered-in-reconciliation";
import type { ReviewLoader } from "./delivered-in-projection-materialiser";

type ReconcileDeliveredInDay = typeof reconcileDeliveredInDay;

export async function invalidateDeliveredInProjection(request: NextRequest, input: DeliveredInInvalidation, options: { loadReview?: ReviewLoader; reconcile?: ReconcileDeliveredInDay; reconciliationContext?: DeliveredInReconciliationContext } = {}) {
  // Menu publication owns operational-day availability. CPU events only
  // change allergen enrichment, so reconcile a safe Menu-only projection
  // directly instead of first hiding the current published day while the CPU
  // packet is pending, generating, revoked, or unavailable.
  if (input.sourceDomain === "cpu-production") {
    const reconciled = await (options.reconcile || reconcileDeliveredInDay)(request, input.oplocId, input.serviceDate, { loadReview: options.loadReview, invalidation: input, reconciliationContext: options.reconciliationContext || { mode: "internal", oplocId: input.oplocId, serviceDate: input.serviceDate } });
    const materialisedResult = reconciled.status === "created" || reconciled.status === "rebuilt" || reconciled.status === "current" || reconciled.status === "withdrawn" ? reconciled.status : "unavailable";
    recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.cpu-enrichment.${materialisedResult}`, source: "SNAPSHOT", documents: 1, cacheHit: false });
    return { result: materialisedResult, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
  }
  const result = await markDeliveredInProjectionStale(input);
  if (result === "missing" || result === "stale") {
    const reconciled = await reconcileDeliveredInDay(request, input.oplocId, input.serviceDate, { loadReview: options.loadReview, invalidation: input, reconciliationContext: options.reconciliationContext || { mode: "internal", oplocId: input.oplocId, serviceDate: input.serviceDate } });
    const materialisedResult = reconciled.status === "created" || reconciled.status === "rebuilt" || reconciled.status === "current" || reconciled.status === "withdrawn" ? reconciled.status : "unavailable";
    recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.invalidation.${materialisedResult}`, source: "SNAPSHOT", documents: 1, cacheHit: false });
    return { result: materialisedResult, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
  }
  const operation = result === "duplicate" ? "invalidation.duplicate" : result === "older" ? "invalidation.older" : "invalidation.withdrawn";
  recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.${operation}`, source: "SNAPSHOT", documents: 1, cacheHit: false });
  return { result, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
}
