import type { NextRequest } from "next/server";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { markDeliveredInProjectionStale, type DeliveredInInvalidation } from "./delivered-in-projection-store";

export async function invalidateDeliveredInProjection(_request: NextRequest, input: DeliveredInInvalidation) {
  const result = await markDeliveredInProjectionStale(input);
  const operation = result === "stale" ? "invalidation.stale" : result === "duplicate" ? "invalidation.duplicate" : result === "older" ? "invalidation.older" : result === "withdrawn" ? "invalidation.withdrawn" : "invalidation.missing";
  recordDataAccess({ app: "delivered-in", operation: `delivered-in.projection.${operation}`, source: "SNAPSHOT", documents: result === "missing" ? 0 : 1, cacheHit: false });
  return { result, oplocId: input.oplocId, serviceDate: input.serviceDate, eventId: input.eventId };
}
