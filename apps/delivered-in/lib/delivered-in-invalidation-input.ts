import type { DeliveredInInvalidation } from "./delivered-in-projection-store";

// Materialisation event IDs embed the canonical publication and destination
// identities; keep the request bounded while allowing those composed IDs.
export const MAX_DELIVERED_IN_INVALIDATION_EVENT_ID_LENGTH = 512;

export function isValidDeliveredInInvalidation(value: unknown): value is DeliveredInInvalidation {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ["menu-planning", "cpu-production", "integration-hub"].includes(String(input.sourceDomain))
    && typeof input.sourceEntityId === "string" && input.sourceEntityId.length > 0 && input.sourceEntityId.length <= 200
    && (input.publicationId === undefined || typeof input.publicationId === "string" && input.publicationId.length <= 200)
    && typeof input.eventId === "string" && input.eventId.length > 0 && input.eventId.length <= MAX_DELIVERED_IN_INVALIDATION_EVENT_ID_LENGTH
    && ["changed", "amended", "withdrawn", "superseded"].includes(String(input.eventType))
    && typeof input.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)
    && typeof input.oplocId === "string" && input.oplocId.length > 0 && input.oplocId.length <= 200
    && (input.sourceVersion === undefined || typeof input.sourceVersion === "string")
    && (input.contentHash === undefined || typeof input.contentHash === "string");
}
