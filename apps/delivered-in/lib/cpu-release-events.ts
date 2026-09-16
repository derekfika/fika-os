import type { NextRequest } from "next/server";
import { createGoogleSiteMenu, retireGoogleSiteMenu } from "./google-site-menu";
import { reconcileDeliveredInDay } from "./delivered-in-reconciliation";
import { invalidateDeliveredInProjection } from "./delivered-in-invalidation";
import { latestSiteMenuArtifactHosted, revokeSiteMenuArtifactHosted, saveSiteMenuArtifactHosted } from "./site-menu-store";
import { acknowledgeSafetyState, publishSafetyState, readAllergenSafetyState, revokeSafetyState, saveAllergenSafetyState } from "./allergen-safety-state";
import { beginCpuReleaseReceipt, completeCpuReleaseReceipt, failCpuReleaseReceipt, type CpuReleaseEventIdentity } from "./cpu-release-receipts";

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
  deliveryId?: string;
};

const id = (value: string) => value.trim();
function logCpuRelease(event: CpuReleaseEvent, phase: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({
    app: "delivered-in",
    operation: "cpu-release",
    phase,
    serviceDate: event.serviceDate,
    oplocId: event.oplocId,
    releaseId: event.releaseId,
    artifactId: details.artifactId || null,
    buildSha: process.env.FIKA_BUILD_SHA || null,
    ...details,
  }));
}

/** Apply one replay-safe CPU release event for one bounded site/date scope. */
export async function applyCpuReleaseEvent(request: NextRequest, event: CpuReleaseEvent) {
  const identity: CpuReleaseEventIdentity = { deliveryId: event.deliveryId || event.eventId, eventId: event.eventId, eventType: event.eventType, releaseId: event.releaseId, releaseVersion: event.releaseVersion, oplocId: event.oplocId, serviceDate: event.serviceDate, sourceDayId: event.sourceDayId, sourcePublicationDayId: event.sourcePublicationDayId, sourceVersion: event.sourceVersion, sourceContentHash: event.sourceContentHash, packetContentHash: event.packetContentHash };
  logCpuRelease(event, "received", { deliveryId: identity.deliveryId, eventType: event.eventType });
  const gate = await beginCpuReleaseReceipt(identity);
  if (gate.status === "duplicate") return { status: "duplicate" as const, receipt: gate.receipt };
  if (gate.status === "superseded") return { status: "superseded" as const, receipt: gate.receipt };
  if (gate.status === "processing") throw Object.assign(new Error("The CPU release delivery is already being applied."), { status: 409, code: "CPU_RELEASE_DELIVERY_IN_PROGRESS" });
  try {
  if (event.eventType === "revoked") {
    logCpuRelease(event, "revocation-received");
    const artifactRevoked = await revokeSiteMenuArtifactHosted(event.oplocId, event.sourceDayId, event.releaseId, event.invalidatedAt);
    logCpuRelease(event, "site-menu-artifact-revoked", { artifactRevoked });
    const result = await invalidateDeliveredInProjection(request, {
      sourceDomain: "cpu-production", sourceEntityId: event.releaseId, eventId: event.eventId, eventType: "withdrawn",
      serviceDate: event.serviceDate, oplocId: event.oplocId, sourceVersion: event.releaseVersion, contentHash: event.packetContentHash,
    });
    logCpuRelease(event, "final-projection-reconciliation", { projectionStatus: result.result });
    const safety = await readAllergenSafetyState(event.oplocId, event.serviceDate, event.releaseVersion);
    if (safety) await saveAllergenSafetyState(revokeSafetyState(safety, event.invalidatedAt || new Date().toISOString()));
    const receipt = await completeCpuReleaseReceipt(identity, { result: "applied", projectionId: `delivered-in:${event.oplocId}:${event.serviceDate}`, projectionContentHash: event.packetContentHash });
    logCpuRelease(event, "receipt-completed", { result: receipt.result });
    return { status: "withdrawn" as const, result: result.result, artifactRevoked, receipt };
  }

  const existing = await latestSiteMenuArtifactHosted(event.oplocId, event.sourceDayId);
  const reconciled = await reconcileDeliveredInDay(request, event.oplocId, event.serviceDate);
  logCpuRelease(event, "pre-artifact-reconciliation", { projectionStatus: reconciled.status, artifactId: existing?.artifactId });
  const projection = "projection" in reconciled ? reconciled.projection : undefined;
  if (!existing || !projection) {
    if (projection) await saveAllergenSafetyState(publishSafetyState({ siteId: event.oplocId, serviceDate: event.serviceDate, releaseId: event.releaseId, releaseVersion: event.releaseVersion, releaseHash: event.packetContentHash, previousReleaseId: existing?.sourceReleaseId, previousReleaseVersion: existing?.sourceReleaseVersion, delta: event.delta, regenerated: false, updatedAt: new Date().toISOString() }));
    const receipt = await completeCpuReleaseReceipt(identity, { result: "applied", projectionId: projection?.projectionId, projectionContentHash: projection?.sourceLineage.menu.contentHash });
    logCpuRelease(event, "receipt-completed", { result: receipt.result, artifactId: existing?.artifactId });
    return { status: "reconciled" as const, regenerated: false, reason: existing ? "no-current-projection" : "no-previous-menu", receipt };
  }
  const changed = new Set((event.changedDishIds || []).map(id).filter(Boolean));
  const affected = projection.entries.some(entry => changed.has(entry.canonicalDishId || entry.sourceEntryId));
  if (!affected) {
    const receipt = await completeCpuReleaseReceipt(identity, { result: "applied", projectionId: projection.projectionId, projectionContentHash: projection.sourceLineage.menu.contentHash });
    logCpuRelease(event, "receipt-completed", { result: receipt.result, artifactId: existing.artifactId, regenerated: false });
    return { status: "reconciled" as const, regenerated: false, reason: "delta-not-allocated", receipt };
  }
  const accessEmail = "system:cpu-release";
  const artifact = await createGoogleSiteMenu(projection, { oplocId: event.oplocId, label: projection.oplocLabel }, accessEmail, existing.driveFileId, event.deliveryId || event.eventId);
  await saveSiteMenuArtifactHosted(artifact);
  logCpuRelease(event, "site-menu-artifact-saved", { artifactId: artifact.artifactId, driveFileId: artifact.driveFileId });
  const finalReconciled = await reconcileDeliveredInDay(request, event.oplocId, event.serviceDate);
  logCpuRelease(event, "final-projection-reconciliation", { projectionStatus: finalReconciled.status, artifactId: artifact.artifactId });
  const finalProjection = "projection" in finalReconciled ? finalReconciled.projection : undefined;
  if (!finalProjection || finalReconciled.status === "superseded" || finalProjection.siteMenu.status !== "current" || finalProjection.sourceLineage.deliveredIn.siteMenuArtifactId !== artifact.artifactId) {
    throw Object.assign(new Error("Delivered-In CPU release did not converge on the saved site-menu artifact."), { code: "DELIVERED_IN_RELEASE_NOT_COHERENT", status: 409 });
  }
  await saveAllergenSafetyState(publishSafetyState({ siteId: event.oplocId, serviceDate: event.serviceDate, releaseId: event.releaseId, releaseVersion: event.releaseVersion, releaseHash: event.packetContentHash, previousReleaseId: existing.sourceReleaseId, previousReleaseVersion: existing.sourceReleaseVersion, delta: event.delta, regenerated: true, updatedAt: new Date().toISOString() }));
  if (existing.driveFileId && existing.driveFileId !== artifact.driveFileId) await retireGoogleSiteMenu(existing.driveFileId);
  const receipt = await completeCpuReleaseReceipt(identity, { result: "applied", projectionId: finalProjection.projectionId, projectionContentHash: finalProjection.sourceLineage.menu.contentHash, artifactId: artifact.artifactId, driveFileId: artifact.driveFileId });
  logCpuRelease(event, "receipt-completed", { result: receipt.result, artifactId: artifact.artifactId, driveFileId: artifact.driveFileId });
  return { status: "reconciled" as const, regenerated: true, artifactId: artifact.artifactId, receipt };
  } catch (error) {
    await failCpuReleaseReceipt(identity, error);
    throw error;
  }
}
