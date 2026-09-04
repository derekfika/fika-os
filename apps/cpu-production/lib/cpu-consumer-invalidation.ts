import type { ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { ProductionOrder } from "./production-types";
import type { CpuAllergenRelease } from "./cpu-allergen-release";

type ConsumerChangeType = "changed" | "amended" | "withdrawn" | "superseded";

export function eventTypeForConsumers(changeType: string): ConsumerChangeType {
  if (changeType.includes("cancel") || changeType === "withdrawn") return "withdrawn";
  if (changeType.includes("supersed")) return "superseded";
  if (changeType.includes("line") || changeType.includes("plan") || changeType.includes("allergen")) return "amended";
  return "changed";
}

export type CpuConsumerInvalidation = {
  eventId: string;
  sourceEntityId: string;
  serviceDate: string;
  sourceVersion: number;
  changedAt: string;
  changeType: ConsumerChangeType;
  order?: Pick<ProductionOrder, "origin" | "destinationOplocId">;
  logistics?: boolean;
  reviewManifest?: Pick<ReadPackageManifest, "contentHash" | "sourceVersion">;
};

export type CpuAllergenReleaseEvent = {
  eventId: string;
  eventType: "published" | "revoked";
  serviceDate: string;
  oplocId: string;
  sourceDayId: string;
  sourcePublicationDayId: string;
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
    sourceDayId: input.release.sourceDayId,
    sourcePublicationDayId: input.release.sourcePublicationDayId,
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
  return postWithRetry(`${deliveredInBaseUrl()}/api/internal/cpu-release-event`, buildCpuAllergenReleaseEvent(input), "delivered-in");
}

function deliveredInBaseUrl() {
  return (process.env.FIKA_APP_DELIVERED_IN_URL || process.env.DELIVERED_IN_BASE_URL || "http://localhost:3800").replace(/\/$/, "");
}

function logisticsBaseUrl() {
  return (process.env.FIKA_LOGISTICS_BASE_URL || "http://localhost:3900").replace(/\/$/, "");
}

function headers() {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) result["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  return result;
}

function logisticsChangeType(changeType: ConsumerChangeType): "amended" | "cancelled" | "withdrawn" | "superseded" | "status-changed" {
  if (changeType === "withdrawn") return "withdrawn";
  if (changeType === "superseded") return "superseded";
  return changeType === "changed" ? "status-changed" : "amended";
}

async function postWithRetry(url: string, body: unknown, consumer: "delivered-in" | "logistics") {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      recordDataAccess({ app: "cpu-production", operation: `consumer-invalidation.${consumer}`, source: "NETWORK_UPSTREAM", documents: 1, cacheHit: false });
      if (!response.ok) throw new Error(`${consumer} invalidation failed (${response.status}).`);
      return { delivered: true, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }
  recordDataAccess({ app: "cpu-production", operation: `consumer-invalidation.${consumer}.failed`, source: "NETWORK_UPSTREAM", documents: 0, cacheHit: false });
  return { delivered: false, attempts: 2, error: lastError instanceof Error ? lastError.message : "Consumer invalidation failed." };
}

export async function notifyCpuConsumerInvalidations(input: CpuConsumerInvalidation) {
  const tasks: Array<Promise<unknown>> = [];
  if (input.order?.origin === "menu_planning" && input.order.destinationOplocId) {
    tasks.push(postWithRetry(`${deliveredInBaseUrl()}/api/delivered-in/invalidate`, {
      sourceDomain: "cpu-production",
      sourceEntityId: input.sourceEntityId,
      eventId: input.eventId,
      eventType: input.changeType,
      serviceDate: input.serviceDate,
      oplocId: input.order.destinationOplocId,
      sourceVersion: input.reviewManifest?.sourceVersion || `cpu-change-${input.sourceVersion}`,
      ...(input.reviewManifest?.contentHash ? { contentHash: input.reviewManifest.contentHash } : {}),
    }, "delivered-in"));
  }
  if (input.logistics && input.order) {
    tasks.push(postWithRetry(`${logisticsBaseUrl()}/api/logistics/invalidate`, {
      serviceDate: input.serviceDate,
      sourceDomain: "cpu-production",
      sourceEntityId: input.sourceEntityId,
      sourceVersion: input.sourceVersion,
      changedAt: input.changedAt,
      changeType: logisticsChangeType(input.changeType),
      ...(input.reviewManifest?.contentHash ? { sourceContentHash: input.reviewManifest.contentHash } : {}),
    }, "logistics"));
  }
  const results = await Promise.all(tasks);
  return { attempted: results.length, results };
}
