import type { ReadPackageManifest } from "@fika/server-shared/read-package";
import type { ProductionOrder } from "./production-types";
import type { CpuAllergenRelease } from "./cpu-allergen-release";
import { deliverCpuPropagations, enqueueCpuDelivery, enqueueCpuPropagation, type CpuConsumerInvalidationInput } from "./cpu-durable-outbox";

type ConsumerChangeType = "changed" | "amended" | "withdrawn" | "superseded";

export function eventTypeForConsumers(changeType: string): ConsumerChangeType {
  if (changeType.includes("cancel") || changeType === "withdrawn") return "withdrawn";
  if (changeType.includes("supersed")) return "superseded";
  if (changeType.includes("line") || changeType.includes("plan") || changeType.includes("allergen")) return "amended";
  return "changed";
}

export type CpuConsumerInvalidation = Omit<CpuConsumerInvalidationInput, "changeType" | "order"> & {
  changeType: ConsumerChangeType;
  order?: Pick<ProductionOrder, "origin" | "destinationOplocId">;
  reviewManifest?: Pick<ReadPackageManifest, "contentHash" | "sourceVersion">;
};

export type CpuAllergenReleaseEvent = {
  eventId: string;
  eventType: "published" | "revoked";
  serviceDate: string;
  oplocId: string;
  sourceOrigin?: "menu_planning" | "hospitality_booking";
  sourceDayId?: string;
  sourcePublicationDayId?: string;
  sourceBookingId?: string;
  sourceQuoteRevisionId?: string;
  sourceRevision?: number;
  sourceVersion: number;
  sourceContentHash: string;
  releaseId: string;
  releaseVersion: string;
  packetContentHash: string;
  changedDishIds: string[];
  invalidatedAt?: string;
  delta: CpuAllergenRelease["deltaFromPrevious"];
};

/** Build the bounded CPU -> Delivered-In safety event from one immutable release. */
export function buildCpuAllergenReleaseEvent(input: {
  release: CpuAllergenRelease;
  oplocId: string;
  eventType: "published" | "revoked";
}): CpuAllergenReleaseEvent {
  const packetContentHash = input.release.packetArtifacts[0]?.contentHash;
  if (!packetContentHash) throw new Error("A CPU allergen release event requires a packet artifact hash.");
  return {
    eventId: `cpu-allergen-release:${input.release.releaseId}:${input.eventType}`,
    eventType: input.eventType,
    serviceDate: input.release.serviceDate,
    oplocId: input.oplocId,
    ...(input.release.sourceOrigin ? { sourceOrigin: input.release.sourceOrigin } : {}),
    ...(input.release.sourceDayId ? { sourceDayId: input.release.sourceDayId } : {}),
    ...(input.release.sourcePublicationDayId ? { sourcePublicationDayId: input.release.sourcePublicationDayId } : {}),
    ...(input.release.sourceBookingId ? { sourceBookingId: input.release.sourceBookingId } : {}),
    ...(input.release.sourceQuoteRevisionId ? { sourceQuoteRevisionId: input.release.sourceQuoteRevisionId } : {}),
    ...(input.release.sourceRevision ? { sourceRevision: input.release.sourceRevision } : {}),
    sourceVersion: input.release.sourceVersion,
    sourceContentHash: input.release.sourceContentHash,
    releaseId: input.release.releaseId,
    releaseVersion: `v${input.release.version}`,
    packetContentHash,
    changedDishIds: input.release.deltaFromPrevious.map(change => change.menuItemId),
    ...(input.eventType === "revoked" && input.release.revokedAt ? { invalidatedAt: input.release.revokedAt } : {}),
    delta: input.release.deltaFromPrevious,
  };
}

export async function notifyDeliveredInAllergenRelease(input: { release: CpuAllergenRelease; oplocId: string; eventType: "published" | "revoked" }) {
  const event = buildCpuAllergenReleaseEvent(input);
  const queued = await enqueueCpuDelivery({ eventId: `${event.eventId}:delivered-in:${input.oplocId}`, sourceAggregateId: event.releaseId, sourceVersion: event.sourceVersion, occurredAt: input.release.signedAt, consumer: "delivered-in", route: "/api/internal/cpu-release-event", body: event as unknown as Record<string, unknown> });
  const [result] = await deliverCpuPropagations([queued]);
  return { delivered: result.status === "delivered", attempts: result.attempts || 0, ...(result.error ? { error: result.error } : {}), deliveryId: queued.eventId };
}

export async function notifyCpuConsumerInvalidations(input: CpuConsumerInvalidation) {
  const queued = await enqueueCpuPropagation({ ...input, changeType: input.changeType, ...(input.order ? { order: input.order } : {}) });
  const deliveries = await deliverCpuPropagations(queued);
  const results = deliveries.map(result => ({ delivered: result.status === "delivered", attempts: result.attempts || (result.status === "blocked" ? 0 : 1), ...(result.error ? { error: result.error } : {}) }));
  return { attempted: queued.length, results, pending: results.filter(result => !result.delivered).length };
}
