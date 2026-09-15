import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { NextRequest } from "next/server";
import { allergenMatrixHtml } from "../app/ui/allergen-matrix";
import { isHostedPdfRuntime, renderPdfToBuffer } from "../app/lib/local-pdf";
import { matrixDriveConfiguration } from "../app/lib/matrix-drive-config";
import type { MatrixArtifact, PlannedMenuItem, ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "./production-types";
import { dailyBundleManifestKey, dailyBundleSha256, encodeDailySignedOplocBundlePackage, buildDailySignedOplocBundle, publishDailySignedOplocBundle, verifyDailySignedOplocBundleArtifacts, type DailyBundleDurableStore } from "@fika/server-shared/daily-signed-oploc-bundle";
import { publishReadPackage } from "@fika/server-shared/read-package";
import { cpuPackageStore } from "./cpu-package-store";
import { allergenMatrixContentHash, materializeCpuAllergenRelease, stageCpuAllergenReleaseMaterialization } from "./cpu-allergen-release";
import { createProductionPlanRepository } from "./production-plan-repository";
import { productionOrderDetail } from "./production-http-client";

const menuContentHash = (items: PlannedMenuItem[]) => allergenMatrixContentHash(items);
const hospitalityBase = () => (process.env.HOSPITALITY_BOOKING_BASE_URL?.trim() || "http://localhost:3300").replace(/\/$/, "");

/** Build and publish artifacts for exactly one governed CPU order/OPLOC. */
export async function createCpuReleaseArtifacts(plan: ProductionPlan, order: ProductionOrder, actor: string, timestamp: string, request: NextRequest, options: { publishPackage?: boolean } = {}) {
  if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
  const subItems = plan.menuItems.flatMap(item => item.subItems);
  if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before saving the matrix."), { status: 422 });
  if (!matrixDriveConfiguration(order).enabled) throw Object.assign(new Error("A configured Drive workspace is required before signing the CPU allergen bundle."), { status: 503 });
  const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
  const signatures = plan.signatures || [];
  if (!signatures.some(signature => signature.role === "production_chef") || !signatures.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("Both required signatures are required for release materialization."), { status: 422 });
  if (!order.destinationOplocId) throw Object.assign(new Error("The signed CPU allergen checker requires a canonical OPLOC output."), { status: 422 });
  const persistPdf = async (kind: "master" | "site", fileName: string, html: string) => {
    const pdfPath = isHostedPdfRuntime() ? undefined : path.join(os.tmpdir(), `fika-cpu-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
    let pdfBase64: string | undefined;
    try { const pdf = await renderPdfToBuffer(html); if (pdfPath) await fs.writeFile(pdfPath, pdf); pdfBase64 = pdf.toString("base64"); } catch (error) { console.error("FIKA PDF renderer failure", { app: "cpu-production", operation: "allergen-pdf-generation", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), productionOrderId: order.canonicalId, serviceDate, requestId: request.headers.get("x-request-id") || undefined, buildSha: process.env.FIKA_BUILD_SHA || undefined }); }
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
  const master = (await persistPdf("master", `CPU-Master-${serviceDate}-${releaseToken}.pdf`, masterHtml)).artifact;
  const siteHtml = allergenMatrixHtml({ clientName: order.clientName, destinationLabel: order.destinationLabel || order.destinationOplocId || "Unassigned destination", serviceType: order.serviceType, serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems.map(withSource), signatures);
  const site = (await persistPdf("site", `${order.destinationLabel || order.destinationOplocId || "Unassigned"}-${serviceDate}-${releaseToken}-Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"), siteHtml)).artifact;
  const packageStore = cpuPackageStore();
  const built = buildDailySignedOplocBundle({ bundleId: `cpu-allergen:${serviceDate}:${order.destinationOplocId}:${plan.currentAllergenRelease?.releaseId || menuContentHash(plan.menuItems)}`, serviceDate, oploc: { id: order.destinationOplocId, name: order.destinationLabel || order.destinationOplocId }, source: { id: order.canonicalId, revision: Math.max(1, order.sourceVersion || plan.currentAllergenRelease?.sourceVersion || 1), contentHash: order.sourceContentHash || "" }, signatures, masterSheet: { contentHash: master.contentHash, fileId: master.driveFileId || "" }, pdf: { contentHash: site.contentHash, fileId: site.driveFileId || "", url: site.driveUrl || site.localUrl }, items: plan.menuItems.flatMap(item => item.subItems.map((sub, index) => ({ menuItemId: index === 0 ? item.sourceLineId || item.id : `${item.sourceLineId || item.id}:sub:${sub.id}`, menuItemName: sub.name || item.name, allergens: sub.allergens, allergenState: sub.evidenceStatus === "completed" ? undefined : "unrecorded" as const }))), signedAt: timestamp });
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
  if (pending.status === "current" && pending.materializationStatus === "ready") return { plan: stored, alreadyMaterialized: true };
  if (pending.status !== "pending" && !(pending.status === "current" && pending.materializationStatus !== "ready")) throw Object.assign(new Error("The CPU allergen release is no longer materializable."), { status: 409 });
  const order = await productionOrderDetail(request, orderId);
  if (!order) throw Object.assign(new Error("The production order could not be loaded for release materialization."), { status: 503 });
  const preparedCandidate = structuredClone(stored);
  try {
    const preparedAt = new Date().toISOString();
    preparedCandidate.currentAllergenRelease = stageCpuAllergenReleaseMaterialization(pending, { masterArtifact: pending.masterArtifact, derivedArtifacts: pending.derivedArtifacts, packetArtifacts: pending.packetArtifacts });
    preparedCandidate.updatedAt = preparedAt;
    preparedCandidate.audit.push({ action: "allergen-matrix-materialization-started", at: preparedAt, by: preparedCandidate.updatedBy, reason: `Authoritative CPU release ${releaseId} is committed before external materialization.` });
    await repository.saveAndAppendCpuChange(preparedCandidate, stored.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: preparedCandidate.id, revision: preparedCandidate.audit.length, changeType: "allergen-release-materialization-started", actorId: preparedCandidate.updatedBy, changedAt: preparedAt, idempotencyKey: `cpu-release-materialize:${releaseId}:started` });
    const prepared = await createCpuReleaseArtifacts(preparedCandidate, order, preparedCandidate.updatedBy, new Date().toISOString(), request, { publishPackage: false });
    const artifactCandidate = structuredClone(preparedCandidate);
    artifactCandidate.currentAllergenRelease = stageCpuAllergenReleaseMaterialization(preparedCandidate.currentAllergenRelease!, { masterArtifact: prepared.masterArtifact, derivedArtifacts: [prepared.siteArtifact], packetArtifacts: prepared.packetArtifacts });
    artifactCandidate.matrixArtifact = prepared.siteArtifact;
    artifactCandidate.signedMatrixArtifact = prepared.siteArtifact;
    artifactCandidate.signedSignatures = artifactCandidate.signatures;
    artifactCandidate.updatedAt = new Date().toISOString();
    artifactCandidate.audit.push({ action: "allergen-matrix-materialized", at: artifactCandidate.updatedAt, by: artifactCandidate.updatedBy, reason: `Prepared artifacts for committed CPU release ${releaseId}.` });
    await repository.saveAndAppendCpuChange(artifactCandidate, preparedCandidate.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: artifactCandidate.id, revision: artifactCandidate.audit.length, changeType: "allergen-release-artifacts-prepared", actorId: artifactCandidate.updatedBy, changedAt: artifactCandidate.updatedAt, idempotencyKey: `cpu-release-materialize:${releaseId}:prepared` });
    await prepared.publish();
    const ready = structuredClone(artifactCandidate);
    ready.currentAllergenRelease = materializeCpuAllergenRelease(artifactCandidate.currentAllergenRelease!, { masterArtifact: prepared.masterArtifact, derivedArtifacts: [prepared.siteArtifact], packetArtifacts: prepared.packetArtifacts });
    ready.updatedAt = new Date().toISOString();
    ready.audit.push({ action: "allergen-matrix-materialized", at: ready.updatedAt, by: ready.updatedBy, reason: `Committed CPU release ${releaseId} materialized.` });
    const release = ready.currentAllergenRelease;
    const oplocId = order.destinationOplocId;
    const deliveries = oplocId ? [{ eventId: `cpu-allergen-release:${release.releaseId}:published:delivered-in:${oplocId}`, sourceAggregateId: release.releaseId, sourceVersion: release.sourceVersion, occurredAt: release.signedAt, consumer: "delivered-in" as const, route: "/api/internal/cpu-release-event", body: { eventId: `cpu-allergen-release:${release.releaseId}:published`, eventType: "published", serviceDate: release.serviceDate, oplocId, sourceDayId: release.sourceDayId, sourcePublicationDayId: release.sourcePublicationDayId, sourceVersion: release.sourceVersion, sourceContentHash: release.sourceContentHash, releaseId: release.releaseId, releaseVersion: `v${release.version}`, packetContentHash: release.packetArtifacts[0]?.contentHash || "", changedDishIds: release.deltaFromPrevious.map(change => change.menuItemId), delta: release.deltaFromPrevious } as Record<string, unknown> }] : [];
    await repository.saveAndAppendCpuChange(ready, artifactCandidate.updatedAt, { serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: ready.id, revision: ready.audit.length, changeType: "allergen-release-materialized", actorId: ready.updatedBy, changedAt: ready.updatedAt, idempotencyKey: `cpu-release-materialize:${releaseId}:final`, deliveries });
    return { plan: ready, alreadyMaterialized: false };
  } catch (error) {
    const failed = structuredClone(await repository.get(orderId) || stored);
    failed.currentAllergenRelease = { ...(failed.currentAllergenRelease || pending), materializationStatus: "failed", materializationError: error instanceof Error ? error.message : String(error) };
    failed.updatedAt = new Date().toISOString();
    try { await repository.save(failed, (await repository.get(orderId) || stored).updatedAt); } catch { /* the retry re-reads authoritative state */ }
    throw error;
  }
}
