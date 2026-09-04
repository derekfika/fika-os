import type { NextRequest } from "next/server";
import { createGoogleSiteMenu, retireGoogleSiteMenu } from "./google-site-menu";
import { reconcileDeliveredInDay } from "./delivered-in-reconciliation";
import { invalidateDeliveredInProjection } from "./delivered-in-invalidation";
import { latestSiteMenuArtifactHosted, revokeSiteMenuArtifactHosted, saveSiteMenuArtifactHosted } from "./site-menu-store";
import { acknowledgeSafetyState, publishSafetyState, readAllergenSafetyState, revokeSafetyState, saveAllergenSafetyState } from "./allergen-safety-state";

export type CpuReleaseEvent = {
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
  changedDishIds?: string[];
  invalidatedAt?: string;
  delta?: Array<{ menuItemId: string; dishName: string; allergen: string; previously: string; now: string }>;
};

const id = (value: string) => value.trim();

/** Apply one replay-safe CPU release event for one bounded site/date scope. */
export async function applyCpuReleaseEvent(request: NextRequest, event: CpuReleaseEvent) {
  if (event.eventType === "revoked") {
    const result = await invalidateDeliveredInProjection(request, {
      sourceDomain: "cpu-production", sourceEntityId: event.releaseId, eventId: event.eventId, eventType: "withdrawn",
      serviceDate: event.serviceDate, oplocId: event.oplocId, sourceVersion: event.releaseVersion, contentHash: event.packetContentHash,
    });
    const artifactRevoked = await revokeSiteMenuArtifactHosted(event.oplocId, event.sourceDayId, event.releaseId, event.invalidatedAt);
    const safety = await readAllergenSafetyState(event.oplocId, event.serviceDate, event.releaseVersion);
    if (safety) await saveAllergenSafetyState(revokeSafetyState(safety, event.invalidatedAt || new Date().toISOString()));
    return { status: "withdrawn" as const, result: result.result, artifactRevoked };
  }

  const existing = await latestSiteMenuArtifactHosted(event.oplocId, event.sourceDayId);
  const reconciled = await reconcileDeliveredInDay(request, event.oplocId, event.serviceDate);
  const projection = "projection" in reconciled ? reconciled.projection : undefined;
  if (!existing || !projection) {
    if (projection) await saveAllergenSafetyState(publishSafetyState({ siteId: event.oplocId, serviceDate: event.serviceDate, releaseId: event.releaseId, releaseVersion: event.releaseVersion, releaseHash: event.packetContentHash, previousReleaseId: existing?.sourceReleaseId, previousReleaseVersion: existing?.sourceReleaseVersion, delta: event.delta, regenerated: false, updatedAt: new Date().toISOString() }));
    return { status: "reconciled" as const, regenerated: false, reason: existing ? "no-current-projection" : "no-previous-menu" };
  }
  const changed = new Set((event.changedDishIds || []).map(id).filter(Boolean));
  const affected = projection.entries.some(entry => changed.has(entry.canonicalDishId || entry.sourceEntryId));
  if (!affected) return { status: "reconciled" as const, regenerated: false, reason: "delta-not-allocated" };
  const accessEmail = "system:cpu-release";
  const artifact = await createGoogleSiteMenu(projection, { oplocId: event.oplocId, label: projection.oplocLabel }, accessEmail, existing.driveFileId);
  await saveSiteMenuArtifactHosted(artifact);
  await saveAllergenSafetyState(publishSafetyState({ siteId: event.oplocId, serviceDate: event.serviceDate, releaseId: event.releaseId, releaseVersion: event.releaseVersion, releaseHash: event.packetContentHash, previousReleaseId: existing.sourceReleaseId, previousReleaseVersion: existing.sourceReleaseVersion, delta: event.delta, regenerated: true, updatedAt: new Date().toISOString() }));
  if (existing.driveFileId && existing.driveFileId !== artifact.driveFileId) await retireGoogleSiteMenu(existing.driveFileId);
  return { status: "reconciled" as const, regenerated: true, artifactId: artifact.artifactId };
}
