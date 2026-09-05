import type { NextRequest } from "next/server";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { markDeliveredInProjectionStale, type DeliveredInInvalidation } from "./delivered-in-projection-store";
import { reconcileDeliveredInDay } from "./delivered-in-reconciliation";
import type { ReviewLoader } from "./delivered-in-projection-materialiser";

export async function invalidateDeliveredInProjection(request: NextRequest, input: DeliveredInInvalidation, options: { loadReview?: ReviewLoader } = {}) {
  const result = await markDeliveredInProjectionStale(input);
  if (result === "missing" || result === "stale") {
    const reconciled = await reconcileDeliveredInDay(request, input.oplocId, input.serviceDate, { loadReview: options.loadReview, invalidation: input });
    const materialisedResult = reconciled.status === "created" || reconciled.status === "rebuilt" || reconciled.status === "current" || reconciled.status === "withdrawn" ? reconciled.status : "unavailable";
    recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.invalidation.${materialisedResult}`, source: "SNAPSHOT", documents: 1, cacheHit: false });
    return { result: materialisedResult, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
  }
  const operation = result === "duplicate" ? "invalidation.duplicate" : result === "older" ? "invalidation.older" : "invalidation.withdrawn";
  recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.${operation}`, source: "SNAPSHOT", documents: 1, cacheHit: false });
  return { result, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
}
