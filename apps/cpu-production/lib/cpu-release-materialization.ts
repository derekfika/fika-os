import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { NextRequest } from "next/server";
import { allergenMatrixHtml } from "../app/ui/allergen-matrix";
import { isHostedPdfRuntime, renderPdfToBuffer } from "../app/lib/local-pdf";
import { matrixDriveConfiguration } from "../app/lib/matrix-drive-config";
import { allergenReleaseLineageMatchesOrder, matrixSignatureScope, type MatrixArtifact, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import { effectiveProductionPlanStatus } from "../app/lib/production-plan-state";
import type { ProductionOrder } from "./production-types";
import { dailyBundleManifestKey, dailyBundleSha256, encodeDailySignedOplocBundlePackage, buildDailySignedOplocBundle, publishDailySignedOplocBundle, verifyDailySignedOplocBundleArtifacts, type DailyBundleDurableStore } from "@fika/server-shared/daily-signed-oploc-bundle";
import { publishReadPackage } from "@fika/server-shared/read-package";
import { cpuPackageStore } from "./cpu-package-store";
import { allergenMatrixContentHash, materializeCpuAllergenRelease, stageCpuAllergenReleaseMaterialization } from "./cpu-allergen-release";
import { createProductionPlanRepository } from "./production-plan-repository";
import { productionOrderDetail } from "./production-http-client";
import { cpuReleaseMaterializationReceiptId } from "./cpu-release-fanout";
import { buildCpuPacketItems } from "./cpu-packet-identity";
import { deliverCpuPropagation } from "./cpu-durable-outbox";

const menuContentHash = (items: PlannedMenuItem[]) => allergenMatrixContentHash(items);
const hospitalityBase = () => (process.env.HOSPITALITY_BOOKING_BASE_URL?.trim() || "http://localhost:3300").replace(/\/$/, "");
export const CPU_RELEASE_RECONCILIATION_DELAY_MS = 60_000;

const durableArtifact = (artifact: MatrixArtifact | undefined): artifact is MatrixArtifact => Boolean(artifact?.pdfStatus === "generated" && artifact.driveStatus === "saved" && artifact.driveFileId && artifact.contentHash);
function rendererFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return Object.assign(new Error(message || "PDF_RENDERER_ERROR: the hosted PDF renderer failed."), { status: 503, code: "PDF_RENDERER_ERROR" });
}

/** Render the one service-date master checker. OPLOC materialisation reuses this identity. */
export async function createCpuMasterArtifact(plan: ProductionPlan, order: ProductionOrder, actor: string, timestamp: string, request: NextRequest, items: PlannedMenuItem[] = plan.menuItems) {
  if (effectiveProductionPlanStatus(plan) !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
  if (!matrixDriveConfiguration(order).enabled) throw Object.assign(new Error("A configured Drive workspace is required before signing the CPU allergen bundle."), { status: 503 });
  const signatures = plan.signatures || [];
  if (!signatures.some(signature => signature.role === "production_chef") || !signatures.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("Both required signatures are required for release materialization."), { status: 422 });
  const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
  const withSource = (item: PlannedMenuItem) => ({ ...item, id: `${order.canonicalId}:${item.id}`, name: item.name });
  const html = allergenMatrixHtml({ clientName: "FIKA OS", destinationLabel: "CPU master allergen checker", serviceType: "Delivered-In menu", serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, items.map(withSource), signatures);
  let pdfBase64: string | undefined;
  try { pdfBase64 = (await renderPdfToBuffer(html)).toString("base64"); } catch (error) { console.error("FIKA PDF renderer failure", { app: "cpu-production", operation: "allergen-master-pdf-generation", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), serviceDate, requestId: request.headers.get("x-request-id") || undefined, buildSha: process.env.FIKA_BUILD_SHA || undefined }); throw rendererFailure(error); }
  if (!pdfBase64) throw Object.assign(new Error("The final allergen checker PDF could not be generated."), { status: 503 });
  const contentHash = dailyBundleSha256(Buffer.from(pdfBase64, "base64"));
  const releaseToken = (plan.currentAllergenRelease?.releaseId || "uncommitted").replace(/[^A-Za-z0-9_-]+/g, "-");
  const fileName = `CPU-Master-${serviceDate}-${releaseToken}.pdf`;
  const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("x-fika-internal-token") ? { "x-fika-internal-token": request.headers.get("x-fika-internal-token")! } : {}), ...(request.headers.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) }, body: JSON.stringify({ name: fileName, html, pdfBase64, productionOrderId: order.canonicalId, releaseId: plan.currentAllergenRelease?.releaseId, weekCommencing: serviceDate }) });
  const body = await response.json().catch(() => undefined) as { saved?: { fileId?: string; driveUrl?: string }; error?: { message?: string } } | undefined;
  if (!response.ok || !body?.saved?.fileId) throw Object.assign(new Error(body?.error?.message || "The final allergen checker could not be durably persisted to the configured Drive workspace."), { status: response.status || 503 });
  return { id: `allergen-master:${serviceDate}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName, createdAt: timestamp, createdBy: actor, contentHash, html, pdfStatus: "generated" as const, driveFileId: body.saved.fileId, driveUrl: body.saved.driveUrl, driveStatus: "saved" as const } satisfies MatrixArtifact;
}

/** A duplicate phase receipt returns the authoritative plan that subsequent phases must use. */
export function resumeCpuMaterializationPhase(result: { duplicate?: boolean; plan?: ProductionPlan }, localCandidate: ProductionPlan, phase: "started" | "prepared" | "final") {
  if (!result.duplicate) return localCandidate;
  if (!result.plan) throw Object.assign(new Error(`The ${phase} materialization receipt has no persisted ProductionPlan.`), { status: 409, code: "CPU_MATERIALIZATION_PHASE_CONFLICT" });
  return result.plan;
}

/** Build and publish artifacts for exactly one governed CPU order/OPLOC. */
export async function createCpuReleaseArtifacts(plan: ProductionPlan, order: ProductionOrder, actor: string, timestamp: string, request: NextRequest, options: { publishPackage?: boolean; masterArtifact?: MatrixArtifact } = {}) {
  if (effectiveProductionPlanStatus(plan) !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
  const subItems = plan.menuItems.flatMap(item => item.subItems);
  if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before saving the matrix."), { status: 422 });
  if (!matrixDriveConfiguration(order).enabled) throw Object.assign(new Error("A configured Drive workspace is required before signing the CPU allergen bundle."), { status: 503 });
  const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
  const signatures = plan.signatures || [];
  if (!signatures.some(signature => signature.role === "production_chef") || !signatures.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("Both required signatures are required for release materialization."), { status: 422 });
  if (!order.destinationOplocId) throw Object.assign(new Error("The signed CPU allergen checker requires a canonical OPLOC output."), { status: 422 });
  const persistPdf = async (kind: "master" | "site", fileName: string, html: string, existing?: MatrixArtifact): Promise<{ kind: "master" | "site"; artifact: MatrixArtifact }> => {
    if (durableArtifact(existing)) return { kind, artifact: existing };
    const pdfPath = isHostedPdfRuntime() ? undefined : path.join(os.tmpdir(), `fika-cpu-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
    let pdfBase64: string | undefined;
    try { const pdf = await renderPdfToBuffer(html); if (pdfPath) await fs.writeFile(pdfPath, pdf); pdfBase64 = pdf.toString("base64"); } catch (error) { console.error("FIKA PDF renderer failure", { app: "cpu-production", operation: "allergen-pdf-generation", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), productionOrderId: order.canonicalId, serviceDate, requestId: request.headers.get("x-request-id") || undefined, buildSha: process.env.FIKA_BUILD_SHA || undefined }); throw rendererFailure(error); }
    if (!pdfBase64) throw Object.assign(new Error("The final allergen checker PDF could not be generated."), { status: 503 });
    const contentHash = dailyBundleSha256(Buffer.from(pdfBase64, "base64"));
    const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("x-fika-internal-token") ? { "x-fika-internal-token": request.headers.get("x-fika-internal-token")! } : {}), ...(request.headers.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) }, body: JSON.stringify({ name: fileName, html, pdfBase64, productionOrderId: order.canonicalId, releaseId: plan.currentAllergenRelease?.releaseId, weekCommencing: serviceDate }) });
    const body = await response.json().catch(() => undefined) as { saved?: { fileId?: string; driveUrl?: string }; error?: { message?: string } } | undefined;
    if (!response.ok || !body?.saved?.fileId) throw Object.assign(new Error(body?.error?.message || "The final allergen checker could not be durably persisted to the configured Drive workspace."), { status: response.status || 503 });
    return { kind, artifact: { id: `allergen-${kind}:${serviceDate}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName, createdAt: timestamp, createdBy: actor, contentHash, html, ...(pdfPath ? { pdfPath, localUrl: `${(process.env.CPU_PUBLIC_BASE_URL || "http://localhost:3400").replace(/\/$/, "")}/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}&download=pdf` } : {}), pdfStatus: "generated" as const, driveFileId: body.saved.fileId, driveUrl: body.saved.driveUrl, driveStatus: "saved" as const } satisfies MatrixArtifact };
  };
  const withSource = (item: PlannedMenuItem) => ({ ...item, id: `${order.canonicalId}:${item.id}`, name: order.destinationOplocId ? `${order.destinationOplocId} · ${item.name}` : item.name });
  const masterHtml = allergenMatrixHtml({ clientName: "FIKA OS", destinationLabel: "CPU master allergen checker", serviceType: "Delivered-In menu", serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems.map(withSource), signatures);
  const releaseToken = (plan.currentAllergenRelease?.releaseId || "uncommitted").replace(/[^A-Za-z0-9_-]+/g, "-");
  const master = durableArtifact(options.masterArtifact)
    ? options.masterArtifact
    : durableArtifact(plan.masterMatrixArtifact)
      ? plan.masterMatrixArtifact
      : (await persistPdf("master", `CPU-Master-${serviceDate}-${releaseToken}.pdf`, masterHtml, plan.masterMatrixArtifact)).artifact;
  const siteHtml = allergenMatrixHtml({ clientName: order.clientName, destinationLabel: order.destinationLabel || order.destinationOplocId || "Unassigned destination", serviceType: order.serviceType, serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems.map(withSource), signatures);
  const site = (await persistPdf("site", `${order.destinationLabel || order.destinationOplocId || "Unassigned"}-${serviceDate}-${releaseToken}-Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"), siteHtml, plan.siteMatrixArtifacts?.[order.destinationOplocId])).artifact;
  const packageStore = cpuPackageStore();
  const sourceScope = matrixSignatureScope(order, menuContentHash(plan.menuItems));
  if (!sourceScope) throw Object.assign(new Error("The current source lineage is unavailable; the signed matrix cannot be materialized."), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
  const built = buildDailySignedOplocBundle({ bundleId: `cpu-allergen:${serviceDate}:${order.destinationOplocId}:${plan.currentAllergenRelease?.releaseId || menuContentHash(plan.menuItems)}`, serviceDate, oploc: { id: order.destinationOplocId, name: order.destinationLabel || order.destinationOplocId }, source: { id: order.canonicalId, revision: sourceScope.sourceVersion, contentHash: sourceScope.sourceContentHash }, signatures, masterSheet: { contentHash: master.contentHash, fileId: master.driveFileId || "" }, pdf: { contentHash: site.contentHash, fileId: site.driveFileId || "", url: site.driveUrl || site.localUrl }, items: buildCpuPacketItems(plan.menuItems, order), signedAt: timestamp });
  const store: DailyBundleDurableStore = { async putPacket(packet, bytes) { await packageStore.putImmutable(built.bundle.packet.objectName, bytes, packet.contentHash); }, async verifyArtifact(artifact) { const bytes = artifact.objectName ? await packageStore.get(artifact.objectName) : undefined; return Boolean(bytes ? dailyBundleSha256(bytes) === artifact.contentHash : artifact.fileId); }, async putManifest(bundle, packet) { if (!packet) throw Object.assign(new Error("The signed daily packet is required before publishing its manifest."), { status: 422 }); const key = dailyBundleManifestKey(bundle.serviceDate, bundle.oploc.id); const previous = await packageStore.getManifest(key); await publishReadPackage(packageStore, key, encodeDailySignedOplocBundlePackage(bundle, packet, (previous?.packageVersion || 0) + 1)); } };
  await verifyDailySignedOplocBundleArtifacts(built.bundle, built.packet, built.packetBytes, store);
  plan.masterMatrixArtifact = master;
  const siteArtifact = { ...site, bundleId: built.bundle.bundleId, packetContentHash: built.bundle.packet.contentHash, packetObjectName: built.bundle.packet.objectName, sourceRevision: built.bundle.source.revision, sourceContentHash: built.bundle.source.contentHash };
  plan.siteMatrixArtifacts = { [order.destinationOplocId]: siteArtifact };
  const publish = async () => publishDailySignedOplocBundle(built.bundle, built.packet, built.packetBytes, store, new Date().toISOString());
  if (options.publishPackage !== false) await publish();
  return { siteArtifact, masterArtifact: master, packetArtifacts: [{ ...siteArtifact, contentHash: built.bundle.packet.contentHash }], publish };
}

export async function materializeCommittedCpuRelease(request: NextRequest, orderId: string, releaseId: string) {
  const repository = createProductionPlanRepository();
  const stored = await repository.get(orderId);
  const pending = stored?.currentAllergenRelease;
  if (!stored || !pending || pending.releaseId !== releaseId) throw Object.assign(new Error("The pending CPU allergen release could not be found."), { status: 409 });
  const order = await productionOrderDetail(request, orderId);
  if (!order) throw Object.assign(new Error("The production order could not be loaded for release materialization."), { status: 503 });
  if (order.origin === "menu_planning" && order.supersededBy) throw Object.assign(new Error("The Menu Planning production order has been superseded; its CPU release cannot be materialized."), { status: 409, code: "CPU_RELEASE_SUPERSEDED_ORDER" });
  if (!allergenReleaseLineageMatchesOrder(pending, order, stored.menuItems)) throw Object.assign(new Error("The committed CPU release no longer matches the canonical source lineage."), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
  if (pending.status === "current" && pending.materializationStatus === "ready") return { plan: stored, alreadyMaterialized: true };
  if (pending.status !== "pending" && !(pending.status === "current" && pending.materializationStatus !== "ready")) throw Object.assign(new Error("The CPU allergen release is no longer materializable."), { status: 409 });
  const materializationReceiptId = (phase: "started" | "prepared" | "final") => cpuReleaseMaterializationReceiptId(releaseId, order, phase);
  const preparedCandidate = structuredClone(stored);
  try {
    const preparedAt = new Date().toISOString();
    preparedCandidate.currentAllergenRelease = stageCpuAllergenReleaseMaterialization(pending, { masterArtifact: pending.masterArtifact, derivedArtifacts: pending.derivedArtifacts, packetArtifacts: pending.packetArtifacts });
    preparedCandidate.updatedAt = preparedAt;
    preparedCandidate.audit.push({ action: "allergen-matrix-materialization-started", at: preparedAt, by: preparedCandidate.updatedBy, reason: `Authoritative CPU release ${releaseId} is committed before external materialization.` });
    const startedResult = await repository.saveAndAppendCpuChange(preparedCandidate, stored.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: preparedCandidate.id, revision: preparedCandidate.audit.length, changeType: "allergen-release-materialization-started", actorId: preparedCandidate.updatedBy, changedAt: preparedAt, idempotencyKey: materializationReceiptId("started") });
    const startedPlan = resumeCpuMaterializationPhase(startedResult, preparedCandidate, "started");
    const prepared = await createCpuReleaseArtifacts(startedPlan, order, startedPlan.updatedBy, new Date().toISOString(), request, { publishPackage: false });
    const artifactCandidate = structuredClone(startedPlan);
    artifactCandidate.currentAllergenRelease = stageCpuAllergenReleaseMaterialization(startedPlan.currentAllergenRelease!, { masterArtifact: prepared.masterArtifact, derivedArtifacts: [prepared.siteArtifact], packetArtifacts: prepared.packetArtifacts });
    artifactCandidate.matrixArtifact = prepared.siteArtifact;
    artifactCandidate.signedMatrixArtifact = prepared.siteArtifact;
    artifactCandidate.signedSignatures = artifactCandidate.signatures;
    artifactCandidate.updatedAt = new Date().toISOString();
    artifactCandidate.audit.push({ action: "allergen-matrix-materialized", at: artifactCandidate.updatedAt, by: artifactCandidate.updatedBy, reason: `Prepared artifacts for committed CPU release ${releaseId}.` });
    const preparedResult = await repository.saveAndAppendCpuChange(artifactCandidate, startedPlan.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: artifactCandidate.id, revision: artifactCandidate.audit.length, changeType: "allergen-release-artifacts-prepared", actorId: artifactCandidate.updatedBy, changedAt: artifactCandidate.updatedAt, idempotencyKey: materializationReceiptId("prepared") });
    const preparedPlan = resumeCpuMaterializationPhase(preparedResult, artifactCandidate, "prepared");
    await prepared.publish();
    const ready = structuredClone(preparedPlan);
    ready.currentAllergenRelease = materializeCpuAllergenRelease(preparedPlan.currentAllergenRelease!, { masterArtifact: prepared.masterArtifact, derivedArtifacts: [prepared.siteArtifact], packetArtifacts: prepared.packetArtifacts });
    ready.updatedAt = new Date().toISOString();
    ready.audit.push({ action: "allergen-matrix-materialized", at: ready.updatedAt, by: ready.updatedBy, reason: `Committed CPU release ${releaseId} materialized.` });
    const release = ready.currentAllergenRelease;
    const oplocId = order.destinationOplocId;
    const deliveries = oplocId && order.origin === "menu_planning" ? (() => {
      const published = { eventId: `cpu-allergen-release:${release.releaseId}:published:delivered-in:${oplocId}`, sourceAggregateId: release.releaseId, sourceVersion: release.sourceVersion, occurredAt: release.signedAt, consumer: "delivered-in" as const, route: "/api/internal/cpu-release-event", body: { eventId: `cpu-allergen-release:${release.releaseId}:published`, eventType: "published", serviceDate: release.serviceDate, oplocId, sourceDayId: release.sourceDayId, sourcePublicationDayId: release.sourcePublicationDayId, sourceVersion: release.sourceVersion, sourceContentHash: release.sourceContentHash, releaseId: release.releaseId, releaseVersion: `v${release.version}`, packetContentHash: release.packetArtifacts[0]?.contentHash || "", changedDishIds: release.deltaFromPrevious.map(change => change.menuItemId), delta: release.deltaFromPrevious } as Record<string, unknown> };
      const dueAt = new Date(Date.now() + CPU_RELEASE_RECONCILIATION_DELAY_MS).toISOString();
      const reconciliation = { eventId: `cpu-allergen-release:${release.releaseId}:reconcile:delivered-in:${oplocId}`, sourceAggregateId: release.releaseId, sourceVersion: release.sourceVersion, occurredAt: dueAt, consumer: "delivered-in" as const, route: "/api/delivered-in/reconcile", body: { oplocId, serviceDate: release.serviceDate } };
      return [published, reconciliation];
    })() : [];
    const finalResult = await repository.saveAndAppendCpuChange(ready, preparedPlan.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: ready.id, revision: ready.audit.length, changeType: "allergen-release-materialized", actorId: ready.updatedBy, changedAt: ready.updatedAt, idempotencyKey: materializationReceiptId("final"), deliveries });
    const finalPlan = resumeCpuMaterializationPhase(finalResult, ready, "final");
    // The release is already durably current. Attempt the staged Delivered-In
    // handoff immediately, while retaining the outbox record for recovery if
    // the consumer is unavailable or times out.
    const handoffResults = await Promise.all(deliveries.filter(delivery => delivery.route === "/api/internal/cpu-release-event").map(delivery => deliverCpuPropagation(delivery.eventId)));
    console.info("FIKA CPU allergen release materialization", { app: "cpu-production", serviceDate: release.serviceDate, releaseId: release.releaseId, destinationOplocId: order.destinationOplocId, expectedOplocCount: 1, materializedOplocCount: 1, failedOplocCount: 0, pendingOplocCount: 0, packetManifestKey: dailyBundleManifestKey(release.serviceDate, order.destinationOplocId || ""), handoffStatus: deliveries.length ? "staged" : "not_applicable" });
    return { plan: finalPlan, alreadyMaterialized: false, handoffResults };
  } catch (error) {
    const materializationError = error instanceof Error ? error.message : String(error);
    console.error("FIKA CPU allergen release materialization failed", { app: "cpu-production", serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), releaseId, destinationOplocId: order.destinationOplocId, expectedOplocCount: 1, materializedOplocCount: 0, failedOplocCount: 1, pendingOplocCount: 1, handoffStatus: "retryable", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: materializationError });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await repository.get(orderId) || stored;
      if (current.currentAllergenRelease?.status === "current" && current.currentAllergenRelease.materializationStatus === "ready") break;
      const failed = structuredClone(current);
      failed.currentAllergenRelease = { ...(failed.currentAllergenRelease || pending), materializationStatus: "failed", materializationError };
      failed.updatedAt = new Date().toISOString();
      try { await repository.save(failed, current.updatedAt); break; } catch (saveError) {
        if ((saveError as { status?: number }).status !== 409 || attempt === 2) throw saveError;
      }
    }
    throw error;
  }
}
