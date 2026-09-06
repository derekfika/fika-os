import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { z } from "zod";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import { matrixSignatureScope, signatureMatchesScope, type AllergenCellState, type InternalMatrixSignature, type MatrixArtifact, type PlannedMenuItem, type ProductionPlan } from "../../lib/production-plan";
import { allergenMatrixHtml } from "../../ui/allergen-matrix";
import { isHostedPdfRuntime, renderPdfToBuffer } from "../../lib/local-pdf";
import os from "node:os";
import { normaliseOperationalAllergens } from "../../../../shared/allergen-contract";
import { productionOrderDetail, productionQueue, transitionProductionOrder } from "../../../lib/production-http-client";
import type { ProductionOrder, ProductionStatus } from "../../../lib/production-types";
import { appendCpuChange, rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "../../../lib/cpu-projection";
import { createProductionPlanRepository } from "../../../lib/production-plan-repository";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { hubJson } from "../../../lib/production-http-client";
import { matrixDriveConfiguration } from "../../lib/matrix-drive-config";
import { loadDeliveredInReviewStatuses, parseDeliveredInReviewOrderIds } from "../../../lib/delivered-in-review";
import { recordDeliveredInReadBudget } from "../../../lib/delivered-in-read-budget";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { rebuildCpuReviewPackage } from "../../../lib/cpu-review-package";
import { eventTypeForConsumers, notifyCpuConsumerInvalidations, notifyDeliveredInAllergenRelease } from "../../../lib/cpu-consumer-invalidation";
import { buildDailySignedOplocBundle, dailyBundleSha256, dailyBundleManifestKey, encodeDailySignedOplocBundlePackage, publishDailySignedOplocBundle, type DailyBundleDurableStore } from "@fika/server-shared/daily-signed-oploc-bundle";
import { publishReadPackage } from "@fika/server-shared/read-package";
import { cpuPackageStore } from "../../../lib/cpu-package-store";
import { allergenMatrixContentHash, buildCpuAllergenRelease, publishCpuAllergenRelease, revokeCpuAllergenRelease } from "../../../lib/cpu-allergen-release";

function menuContentHash(menuItems: PlannedMenuItem[]) {
  return allergenMatrixContentHash(menuItems);
}

export const dynamic = "force-dynamic";

const actorFor = (request: NextRequest) => requireCpuActor(request);

async function syncCanonicalLifecycle(
  request: NextRequest,
  orderId: string,
  target: "accepted" | "planned" | "rejected" | "needs_clarification",
  reason: string,
) {
  if (orderId.startsWith("production-order:v1:fixture:")) return undefined;
  let order = await productionOrderDetail(request, orderId);
  if (!order) return undefined;
  const step = async (status: ProductionStatus) => {
    order = (await transitionProductionOrder(request, { action: "transition", canonicalId: orderId, expectedVersion: order!.version, status, reason })).order;
  };
  if (target === "accepted" && order.status === "draft") {
    await step("needs_review");
  }
  if (target === "planned") {
    // A local CPU plan can be completed directly from a newly created
    // hospitality hand-off. Keep the governed production lifecycle in sync by
    // walking the same explicit transitions a chef would use.
    if (order.status === "draft") await step("needs_review");
    if (order.status === "needs_review") await step("accepted");
    if (order.status === "accepted") await step("planning");
  }
  if (order.status !== target) {
    const allowed =
      target === "planned" && order.status === "planning"
        ? true
        : target === "accepted" && order.status === "needs_review"
          ? true
          : ["rejected", "needs_clarification"].includes(target) &&
              order.status === "needs_review";
    if (allowed) await step(target);
  }
  return order;
}

const SubItem = z.object({ id: z.string().min(1), productionItemId: z.string().min(1).optional(), name: z.string(), quantity: z.number().positive().nullable(), allergens: z.record(z.string(), z.enum(["clear", "contains", "may_contain"])), mayContainNotes: z.string().optional(), note: z.string(), evidenceStatus: z.enum(["not_completed", "completed", "requires_review"]) });
const MenuItem = z.object({ id: z.string().min(1), sourceLineId: z.string().optional(), name: z.string(), note: z.string(), subItems: z.array(SubItem) });
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), orderId: z.string() }),
  z.object({ action: z.literal("reject"), orderId: z.string(), reason: z.string().trim().min(3) }),
  z.object({ action: z.literal("clarify"), orderId: z.string(), note: z.string().trim().min(3) }),
  z.object({ action: z.literal("save-plan"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default("") }),
  z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default("") }),
  z.object({ action: z.literal("sign-matrix"), orderId: z.string(), role: z.enum(["production_chef", "head_chef_site_manager"]), printedName: z.string().trim().min(2).max(120), attestation: z.string().trim().min(10).max(500), signatureDataUrl: z.string().regex(/^data:image\/png;base64,/).max(500000) }),
  z.object({ action: z.literal("save-matrix"), orderId: z.string() }),
]);
const MatrixOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-plan"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default("") }),
  z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default("") }),
]);
const MatrixBatchCommand = z.object({ action: z.literal("batch-plan"), operations: z.array(MatrixOperation).min(1).max(100) }).strict();

const plans = new Map<string, ProductionPlan>();
const planRepository = createProductionPlanRepository();
const isLocalRuntime = () => (process.env.FIKA_RUNTIME_MODE || "local") === "local";
function normalisePlanAllergens(plan: ProductionPlan): ProductionPlan {
  return { ...plan, menuItems: plan.menuItems.map(item => ({ ...item, subItems: item.subItems.map(sub => ({ ...sub, allergens: normaliseOperationalAllergens(sub.allergens) })) })) };
}
async function persistPlan(plan: ProductionPlan, expectedUpdatedAt?: string) { await planRepository.save(plan, expectedUpdatedAt); }
function now() { return new Date().toISOString(); }
function revokeCurrentAllergenRelease(plan: ProductionPlan, actor: string, at: string) {
  const current = plan.currentAllergenRelease;
  if (!current || current.status !== "current") return false;
  plan.allergenReleaseHistory = [...(plan.allergenReleaseHistory || []), revokeCpuAllergenRelease(current, { at, by: actor, reason: "Allergen matrix changed after signed release." })];
  plan.currentAllergenRelease = undefined;
  plan.signedMenuContentHash = undefined;
  plan.signedSignatures = undefined;
  plan.signedMatrixArtifact = undefined;
  plan.audit.push({ action: "allergen-release-revoked", at, by: actor, reason: "Allergen matrix changed after signed release." });
  return true;
}
async function loadOrder(request: NextRequest, orderId: string) {
  try {
    const order = await productionOrderDetail(request, orderId);
    return order || (isLocalRuntime() ? localFixtureOrders().find(item => item.canonicalId === orderId) : undefined);
  } catch {
    if (isLocalRuntime()) return localFixtureOrders().find(item => item.canonicalId === orderId);
    throw Object.assign(new Error("Canonical Production data is unavailable."), { status: 503 });
  }
}
async function isVisibleForCpu(request: NextRequest, orderId: string) {
  const order = await loadOrder(request, orderId);
  return !(order?.origin === "hospitality_booking" && order.requiresDelivery === false);
}
function initialPlan(orderId: string, order?: Awaited<ReturnType<typeof productionOrderDetail>> | ProductionOrder): ProductionPlan {
  const timestamp = now();
  return { id: `production-plan:${orderId}`, orderId, status: "draft", menuItems: (order?.lines || []).map((line, index) => ({ id: `menu-item:${orderId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:${index + 1}:1`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" }] })), planningNotes: "", updatedAt: timestamp, updatedBy: "local-fixture", audit: [{ action: "plan-created", at: timestamp, by: "local-fixture" }] };
}
async function getPlan(request: NextRequest, orderId: string, knownPlan?: ProductionPlan) {
  if (knownPlan) plans.set(orderId, normalisePlanAllergens(knownPlan));
  if (!plans.has(orderId)) {
    const persisted = await planRepository.get(orderId);
    if (persisted) plans.set(orderId, normalisePlanAllergens(persisted));
  }
  if (!plans.has(orderId)) {
    // Canonical hand-offs are the source of truth. Local fixtures remain a
    // development fallback, but must never be the only seed for a real order.
    const order = await loadOrder(request, orderId);
    const priorPlans = (await Promise.all([...plans.values()].filter(plan => plan.orderId !== orderId).map(async plan => ({ plan, order: await loadOrder(request, plan.orderId) })))).filter(item => item.order?.sourceBookingId && item.order.sourceBookingId === order?.sourceBookingId).sort((a, b) => b.plan.updatedAt.localeCompare(a.plan.updatedAt));
    const prior = priorPlans[0]?.plan;
    if (prior && order) {
      const menuItems = prior.menuItems.map((item, index) => {
        const line = order.lines[index];
        return line ? { ...item, sourceLineId: line.canonicalId, subItems: item.subItems.map(sub => ({ ...sub, quantity: line.customerQuantity })) } : item;
      });
      plans.set(orderId, { ...prior, id: `production-plan:${orderId}`, orderId, status: "draft", menuItems, signatures: undefined, matrixArtifact: undefined, masterMatrixArtifact: undefined, siteMatrixArtifacts: undefined, updatedAt: now(), updatedBy: "system", audit: [...prior.audit, { action: "plan-carried-to-amended-order", at: now(), by: "system", reason: "The Booking was amended; prior allergen work was retained as a draft for the replacement CPU order." }] });
    } else {
      plans.set(orderId, initialPlan(orderId, order));
    }
  }
  return plans.get(orderId)!;
}

async function applyMatrixOperation(request: NextRequest, actor: Awaited<ReturnType<typeof actorFor>>, operation: z.infer<typeof MatrixOperation>) {
  const order = await loadOrder(request, operation.orderId);
  if (!order || (order.origin === "hospitality_booking" && order.requiresDelivery === false)) throw Object.assign(new Error("CPU delivery is not selected for this booking, so no CPU production work is required."), { status: 422 });
  const storedPlan = await planRepository.get(operation.orderId);
  if (!storedPlan && !isLocalRuntime()) plans.delete(operation.orderId);
  const plan = await getPlan(request, operation.orderId, storedPlan);
  const auditActor = actor.name || actor.uid;
  const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: operation.menuItems }).menuItems }, operation.orderId, order)).menuItems;
  const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
  const matchesSignedCheckpoint = plan.signedMenuContentHash === menuContentHash(nextMenuItems);
  plan.menuItems = nextMenuItems;
  plan.planningNotes = operation.planningNotes;
  if (operation.action === "save-plan") {
    plan.status = matchesSignedCheckpoint ? "planned" : "planning";
    if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else { if (contentChanged) revokeCurrentAllergenRelease(plan, auditActor, now()); plan.signatures = undefined; plan.matrixArtifact = undefined; plan.masterMatrixArtifact = undefined; plan.siteMatrixArtifacts = undefined; }
    plan.audit.push({ action: "plan-saved", at: now(), by: auditActor });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planning", version: current.version + 1 }));
  } else {
    const subItems = plan.menuItems.flatMap(item => item.subItems);
    if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
    if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else if (contentChanged) { revokeCurrentAllergenRelease(plan, auditActor, now()); plan.signatures = undefined; plan.matrixArtifact = undefined; plan.masterMatrixArtifact = undefined; plan.siteMatrixArtifacts = undefined; }
    plan.status = "planned";
    plan.audit.push({ action: "plan-marked-planned", at: now(), by: auditActor });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planned", version: current.version + 1 }));
    await syncCanonicalLifecycle(request, operation.orderId, "planned", "Production plan marked Planned by the production chef.");
  }
  const timestamp = now();
  plan.updatedAt = timestamp; plan.updatedBy = auditActor;
  await persistPlan(plan, storedPlan?.updatedAt);
  const changedOrder = await loadOrder(request, operation.orderId);
  if (!changedOrder?.serviceDate) return { orderId: operation.orderId, plan, serviceDate: undefined, sequence: undefined };
  const event = await appendCpuChange({ serviceDate: changedOrder.serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: operation.action, actorId: actor.uid, changedAt: timestamp });
  return { orderId: operation.orderId, plan, serviceDate: changedOrder.serviceDate, sequence: event.sequence };
}
function hospitalityBase() {
  const configured = process.env.HOSPITALITY_BOOKING_BASE_URL?.trim();
  if (!configured) {
    if (!isLocalRuntime()) throw Object.assign(new Error("Hospitality Booking base URL is not configured for hosted CPU matrix persistence."), { status: 503 });
    return "http://localhost:3300";
  }
  return configured.replace(/\/$/, "");
}
async function mergeOriginalItems(request: NextRequest, plan: ProductionPlan, orderId: string, knownOrder?: ProductionOrder): Promise<ProductionPlan> {
  const order = knownOrder || await loadOrder(request, orderId);
  if (!order) return plan;
  const existing = new Set(plan.menuItems.map(item => item.sourceLineId || item.id));
  const missing = order.lines.filter(line => !existing.has(line.canonicalId)).map((line, index) => ({ id: `menu-item:${orderId}:original:${index}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:original:${index}`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" as const }] }));
  return missing.length ? { ...plan, menuItems: [...plan.menuItems, ...missing] } : plan;
}

async function createMatrixArtifact(plan: ProductionPlan, orderId: string, actor: string, timestamp: string, request: NextRequest) {
  if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
  const subItems = plan.menuItems.flatMap(item => item.subItems);
  if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before saving the matrix."), { status: 422 });
  const order = await loadOrder(request, orderId);
  if (!order) throw Object.assign(new Error("The production order could not be loaded."), { status: 404 });
  // A signed release must have a durable PDF.  Configuration gaps therefore
  // fail closed instead of allowing signatures to look complete without audit
  // bytes.
  // Historical compatibility marker (the old implementation used
  // `if (!matrixDriveConfiguration(order).enabled) return undefined;` here).
  if (!matrixDriveConfiguration(order).enabled) throw Object.assign(new Error("A configured Drive workspace is required before signing the CPU allergen bundle."), { status: 503 });
  const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
  const weekCommencing = weekCommencingFor(serviceDate);
  // Daily release scope: a signing action for one service date must not
  // silently pull another day into the signed source revision.
  const dailyOrders = (await productionQueue(request, serviceDate)).filter(candidate => candidate.origin === "menu_planning" && (candidate.serviceDate || candidate.requiredBy.slice(0, 10)) === serviceDate);
  const storedPlans = await planRepository.getByOrderIds(dailyOrders.map(candidate => candidate.canonicalId));
  const planByOrderId = new Map(storedPlans.map(candidate => [candidate.orderId, normalisePlanAllergens(candidate)]));
  planByOrderId.set(orderId, normalisePlanAllergens(plan));
  const fullySigned = (pair: { order: ProductionOrder; plan: ProductionPlan }) => {
    const scope = matrixSignatureScope(pair.order, menuContentHash(pair.plan.menuItems));
    const signatures = pair.plan.signatures || [];
    return pair.plan.status === "planned" && pair.plan.menuItems.length > 0 && pair.plan.menuItems.every(item => item.subItems.length > 0 && item.subItems.every(sub => sub.name.trim())) && signatures.some(signature => signature.role === "production_chef" && signatureMatchesScope(signature, scope)) && signatures.some(signature => signature.role === "head_chef_site_manager" && signatureMatchesScope(signature, scope));
  };
  const signedPairs = dailyOrders.flatMap(candidate => { const candidatePlan = planByOrderId.get(candidate.canonicalId); const pair = candidatePlan ? { order: candidate, plan: candidatePlan } : undefined; return pair && fullySigned(pair) ? [pair] : []; });
  if (!signedPairs.some(pair => pair.order.canonicalId === orderId)) signedPairs.push({ order, plan });
  const stableFileToken = (value: string) => value.replace(/^oploc:/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unassigned";
  const allSignatures = signedPairs.flatMap(pair => (pair.plan.signatures || []).filter(signature => signatureMatchesScope(signature, matrixSignatureScope(pair.order, menuContentHash(pair.plan.menuItems)))));
  const withSource = (pair: { order: ProductionOrder; plan: ProductionPlan }, prefix: string) => pair.plan.menuItems.map(item => ({ ...item, id: `${prefix}:${item.id}`, name: pair.order.destinationOplocId ? `${pair.order.destinationOplocId} · ${item.name}` : item.name }));
  const masterItems = signedPairs.flatMap(pair => withSource(pair, pair.order.canonicalId));
  const sitePairs = new Map<string, Array<{ order: ProductionOrder; plan: ProductionPlan }>>();
  for (const pair of signedPairs) if (pair.order.destinationOplocId) sitePairs.set(pair.order.destinationOplocId, [...(sitePairs.get(pair.order.destinationOplocId) || []), pair]);
  const artifacts: Array<{ kind: "master" | "site"; oplocId?: string; artifact: MatrixArtifact }> = [];
  const persistPdf = async (kind: "master" | "site", fileName: string, html: string, sourceOrder: ProductionOrder, sourceOrderId: string) => {
    const pdfPath = isHostedPdfRuntime() ? undefined : path.join(os.tmpdir(), `fika-cpu-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
    let pdfBase64: string | undefined; let pdfStatus: "generated" | "unavailable" = "unavailable";
    try { const pdf = await renderPdfToBuffer(html); if (pdfPath) await fs.writeFile(pdfPath, pdf); pdfBase64 = pdf.toString("base64"); pdfStatus = "generated"; } catch (error) {
      console.error("FIKA PDF renderer failure", { app: "cpu-production", operation: "allergen-pdf-generation", runtime: process.env.FIKA_RUNTIME_MODE || process.env.NODE_ENV || "unknown", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, productionOrderId: orderId, serviceDate, weekCommencing, requestId: request.headers.get("x-request-id") || undefined, buildSha: process.env.FIKA_BUILD_SHA || undefined });
    }
    if (!pdfBase64) throw Object.assign(new Error("The final allergen checker PDF could not be generated."), { status: 503 });
    const pdfContentHash = dailyBundleSha256(Buffer.from(pdfBase64, "base64"));
    try {
      const drivePayload = { name: fileName, html, pdfBase64, productionOrderId: orderId, weekCommencing };
      const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) }, body: JSON.stringify(drivePayload) });
      const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null; error?: { message?: string } };
      if (!response.ok || !body.saved?.fileId) throw Object.assign(new Error(body.error?.message || "The final allergen checker could not be durably persisted to the configured Drive workspace."), { status: response.status || 503 });
      return { kind, ...(kind === "site" ? { oplocId: sourceOrder.destinationOplocId } : {}), artifact: { id: `allergen-${kind}:${serviceDate}:${pdfContentHash.slice(0, 16)}`, bookingId: sourceOrder.sourceBookingId, fileName, createdAt: timestamp, createdBy: actor, contentHash: pdfContentHash, html, ...(pdfPath ? { pdfPath, localUrl: `${(process.env.CPU_PUBLIC_BASE_URL || "http://localhost:3400").replace(/\/$/, "")}/api/production-plan?orderId=${encodeURIComponent(sourceOrderId)}&download=pdf` } : {}), pdfStatus, driveFileId: body.saved.fileId, driveUrl: body.saved.driveUrl, driveStatus: "saved" as const } };
    } catch (error) { if (error && typeof error === "object" && "status" in error) throw error; throw Object.assign(new Error("The final allergen checker could not be persisted to the configured Drive workspace."), { status: 503 }); }
  };
  const masterHtml = allergenMatrixHtml({ clientName: "FIKA OS", destinationLabel: "CPU master allergen checker", serviceType: "Delivered-In menu", serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, masterItems, allSignatures);
  // Keep the old week token available for compatibility with archived folder
  // indexes; new release filenames are service-day scoped.
  const legacyMasterFileName = `master-${weekCommencing}.pdf`;
  void legacyMasterFileName;
  artifacts.push(await persistPdf("master", `CPU-Master-${serviceDate}.pdf`, masterHtml, order, orderId));
  for (const [oplocId, pairs] of sitePairs) {
    const source = pairs[0].order;
    const siteHtml = allergenMatrixHtml({ clientName: source.clientName, destinationLabel: source.destinationLabel || oplocId, serviceType: source.serviceType, serviceDate, serviceWindow: source.serviceWindow, requiredBy: source.requiredBy }, pairs.flatMap(pair => withSource(pair, pair.order.canonicalId)), allSignatures);
    const legacySiteFileName = `oploc-${stableFileToken(oplocId)}-${weekCommencing}.pdf`;
    void legacySiteFileName;
    const actualOplocName = source.destinationLabel || oplocId;
    artifacts.push(await persistPdf("site", `${actualOplocName}-${serviceDate}-Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_"), siteHtml, source, source.canonicalId));
  }
  const currentSite = artifacts.find(item => item.kind === "site" && item.oplocId === order.destinationOplocId)?.artifact;
  const master = artifacts.find(item => item.kind === "master")!.artifact;
  if (!currentSite) throw Object.assign(new Error("The signed CPU allergen checker has no canonical OPLOC output."), { status: 422 });
  plan.masterMatrixArtifact = master;
  plan.siteMatrixArtifacts = Object.fromEntries(artifacts.filter(item => item.kind === "site" && item.oplocId).map(item => [item.oplocId!, item.artifact]));

  // Publish the minimized daily packet and its manifest only after every PDF
  // and the CPU master sheet have durable Drive identities. The packet itself
  // is immutable/content-addressed; the manifest is the final write.
  const currentOploc = order.destinationOplocId ? { id: order.destinationOplocId, name: order.destinationLabel || order.destinationOplocId } : undefined;
  if (currentOploc) {
    // Menu Planning's published day hash is the cross-app source identity.
    // A missing hand-off hash blocks publication rather than creating a
    // packet that Delivered-In cannot safely bind to its published day.
    const sourceContentHash = order.sourceContentHash;
    if (!sourceContentHash) throw Object.assign(new Error("The CPU daily bundle requires the Menu Planning source content hash."), { status: 422 });
    const built = buildDailySignedOplocBundle({
      bundleId: `cpu-allergen:${serviceDate}:${currentOploc.id}:r${plan.audit.length}`,
      serviceDate,
      oploc: currentOploc,
      source: { id: plan.id, revision: Math.max(1, order.sourceVersion || plan.audit.length), contentHash: sourceContentHash },
      signatures: plan.signatures || [],
      masterSheet: { contentHash: master.contentHash, fileId: master.driveFileId || "" },
      pdf: { contentHash: currentSite.contentHash, fileId: currentSite.driveFileId || "", url: currentSite.driveUrl || currentSite.localUrl },
      items: signedPairs.filter(pair => pair.order.destinationOplocId === currentOploc.id).flatMap(pair => pair.plan.menuItems.flatMap(item => {
        const sourceLine = pair.order.lines.find(line => line.canonicalId === item.sourceLineId);
        const stableEntryId = sourceLine?.sourceBookingLineId || sourceLine?.canonicalId || item.sourceLineId;
        return item.subItems.map((sub, index) => ({
          // Delivered-In day entries are keyed by Menu Planning's source
          // booking line identity, never by a transient CPU sub-item ID.
          menuItemId: index === 0 ? stableEntryId || sub.id : `${stableEntryId || sub.id}:sub:${sub.id}`,
          menuItemName: sub.name || item.name,
          allergens: sub.allergens,
          allergenState: sub.evidenceStatus === "completed" ? undefined : "unrecorded" as const,
        }));
      })),
      signedAt: timestamp,
    });
    const packageStore = cpuPackageStore();
    const dailyStore: DailyBundleDurableStore = {
      async putPacket(packet, bytes) { await packageStore.putImmutable(built.bundle.packet.objectName, bytes, packet.contentHash); },
      async verifyArtifact(artifact) {
        if (artifact.objectName) { const bytes = await packageStore.get(artifact.objectName); return Boolean(bytes && dailyBundleSha256(bytes) === artifact.contentHash); }
        return Boolean(artifact.fileId);
      },
      async putManifest(bundle, packet) {
        if (!packet) throw Object.assign(new Error("The signed daily packet is required before publishing its manifest."), { status: 422 });
        const key = dailyBundleManifestKey(bundle.serviceDate, bundle.oploc.id);
        const previous = await packageStore.getManifest(key);
        const encoded = encodeDailySignedOplocBundlePackage(bundle, packet, (previous?.packageVersion || 0) + 1);
        await publishReadPackage(packageStore, key, encoded);
      },
    };
    await publishDailySignedOplocBundle(built.bundle, built.packet, built.packetBytes, dailyStore, timestamp);
    currentSite.bundleId = built.bundle.bundleId;
    currentSite.packetContentHash = built.bundle.packet.contentHash;
    currentSite.packetObjectName = built.bundle.packet.objectName;
    currentSite.sourceRevision = built.bundle.source.revision;
    currentSite.sourceContentHash = built.bundle.source.contentHash;
  }
  return currentSite;
}

async function handleGet(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  try {
    const actor = await actorFor(request);
    if (request.nextUrl.searchParams.get("reviewStatus") === "1") {
      const orderIds = parseDeliveredInReviewOrderIds(request.nextUrl.searchParams.get("orderIds"));
      const reviewStatuses = await loadDeliveredInReviewStatuses({ orderIds, repository: planRepository, loadOrder: (id) => loadOrder(request, id) });
      return NextResponse.json({ reviewStatuses });
    }
    if (request.nextUrl.searchParams.get("matrixStatus") === "1") {
      const orderIds = parseDeliveredInReviewOrderIds(request.nextUrl.searchParams.get("orderIds"));
      const matrixStatuses = await loadDeliveredInReviewStatuses({ orderIds, repository: planRepository, loadOrder: (id) => loadOrder(request, id), includeMatrix: true });
      recordDeliveredInReadBudget({ stage: "matrix_hydration", selectedIds: orderIds.length });
      return NextResponse.json({ matrixStatuses });
    }
    const serviceDate = request.nextUrl.searchParams.get("serviceDate");
    if (serviceDate) {
      const sourceOrders = await productionQueue(request, serviceDate);
      const selectedPlans = await planRepository.getByOrderIds(sourceOrders.map(order => order.canonicalId));
      const planByOrderId = new Map(selectedPlans.map(plan => [plan.orderId, normalisePlanAllergens(plan)]));
      const visiblePlans = await Promise.all(sourceOrders
        .filter(order => !(order.origin === "hospitality_booking" && order.requiresDelivery === false))
        .map(async order => mergeOriginalItems(request, planByOrderId.get(order.canonicalId) || await getPlan(request, order.canonicalId), order.canonicalId, order)));
      const entries = visiblePlans.filter(plan => plan.status === "planned");
      return NextResponse.json({ plans: visiblePlans, notifications: entries.map(plan => ({ id: `notification:${plan.id}`, title: "New production plan ready for menu generation.", orderId: plan.orderId, plannedItemCount: plan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: plan.updatedAt })), menus: entries.map(plan => ({ planId: plan.id, orderId: plan.orderId, clientSite: sourceOrders.find(order => order.canonicalId === plan.orderId)?.destinationLabel || "Site not assigned", items: plan.menuItems.flatMap(item => item.subItems.map(subItem => ({ menuItem: item.name, name: subItem.name, quantity: subItem.quantity, allergens: Object.entries(subItem.allergens).filter(([, state]) => state === "contains").map(([key]) => key), mayContain: Object.entries(subItem.allergens).filter(([, state]) => state === "may_contain").map(([key]) => key) }))) })) });
    }
    if (orderId) {
      const selectedOrder = await loadOrder(request, orderId);
      const visible = Boolean(selectedOrder && !(selectedOrder.origin === "hospitality_booking" && selectedOrder.requiresDelivery === false));
      if (request.nextUrl.searchParams.get("download") === "pdf") {
        const artifact = visible ? (await getPlan(request, orderId)).matrixArtifact : undefined;
        if (!artifact?.pdfPath || !existsSync(artifact.pdfPath)) return NextResponse.json({ error: { message: "A local PDF has not been generated for this matrix." } }, { status: 404 });
        return new NextResponse(await fs.readFile(artifact.pdfPath), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${artifact.fileName}"` } });
      }
      const selectedPlan = visible ? await mergeOriginalItems(request, await getPlan(request, orderId), orderId, selectedOrder) : undefined;
      recordDeliveredInReadBudget({ stage: "selected_order_get", canonicalOrderDocs: selectedOrder ? 1 : 0, planDocs: selectedPlan ? 1 : 0, selectedIds: 1 });
      const selectedMatrixStatus = selectedPlan?.matrixArtifact ? "ready" : selectedPlan?.signatures?.some(signature => signature.role === "production_chef") && selectedPlan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? selectedOrder && !matrixDriveConfiguration(selectedOrder).enabled ? "not_configured" : "generating" : undefined;
      return NextResponse.json({ plan: selectedPlan, matrixStatus: selectedMatrixStatus, plans: selectedPlan ? [selectedPlan] : [], notifications: selectedPlan?.status === "planned" ? [{ id: `notification:${selectedPlan.id}`, title: "New production plan ready for menu generation.", orderId: selectedPlan.orderId, plannedItemCount: selectedPlan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: selectedPlan.updatedAt }] : [], menus: [] });
    }
  } catch (error) {
    return errorResponse(error);
  }
  recordDataAccess({ app: "cpu-production", operation: "production-plans.rejected-unsafe-broad-request", source: "UNKNOWN", documents: 0 });
  throw Object.assign(new Error("A production plan selector is required. Request an orderId or an explicit bounded orderIds list."), { status: 400, code: "PLAN_SCOPE_REQUIRED" });
}

async function handlePost(request: NextRequest) {
  try {
    const actor = await actorFor(request);
    const raw = await request.json();
    if (raw?.action === "batch-plan") {
      const batch = MatrixBatchCommand.parse(raw);
      const results: Array<{ orderId: string; ok: boolean; planStatus?: ProductionPlan["status"]; error?: string }> = [];
      const latestSequenceByDate = new Map<string, number>();
      for (const operation of batch.operations) {
        try {
          const result = await applyMatrixOperation(request, actor, operation);
          if (result.serviceDate && result.sequence) latestSequenceByDate.set(result.serviceDate, Math.max(latestSequenceByDate.get(result.serviceDate) || 0, result.sequence));
          results.push({ orderId: operation.orderId, ok: true, planStatus: result.plan.status });
        } catch (error) {
          results.push({ orderId: operation.orderId, ok: false, error: error instanceof Error ? error.message : "The matrix operation failed." });
        }
      }
      const affectedDates = [...latestSequenceByDate.keys()];
      const affectedWeeks = new Map<string, number>();
      for (const serviceDate of affectedDates) {
        const sequence = latestSequenceByDate.get(serviceDate);
        await rebuildCpuDayProjection(request, serviceDate, sequence);
        const week = weekCommencingFor(serviceDate);
        affectedWeeks.set(week, Math.max(affectedWeeks.get(week) || 0, sequence || 0));
      }
      for (const [week, sequence] of affectedWeeks) {
        await rebuildCpuWeekProjection(request, week, sequence || undefined);
      }
      for (const serviceDate of affectedDates) {
        const affectedOrders = await Promise.all(batch.operations.filter(operation => latestSequenceByDate.has(serviceDate)).map(operation => loadOrder(request, operation.orderId)));
        for (const oplocId of [...new Set(affectedOrders.map(order => order?.destinationOplocId).filter((id): id is string => Boolean(id)))]) {
          const review = await rebuildCpuReviewPackage(request, serviceDate, oplocId, latestSequenceByDate.get(serviceDate));
          const sourceVersion = latestSequenceByDate.get(serviceDate) || 0;
          await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${sourceVersion}:review:${oplocId}`, sourceEntityId: `cpu-review:${oplocId}:${serviceDate}`, serviceDate, sourceVersion, changedAt: new Date().toISOString(), changeType: "amended", order: { origin: "menu_planning", destinationOplocId: oplocId }, logistics: false, reviewManifest: review.manifest });
        }
      }
      recordDeliveredInReadBudget({ stage: "matrix_batch_mutation", planDocs: results.filter(result => result.ok).length, selectedIds: batch.operations.length, rebuildScopes: affectedDates.length + affectedWeeks.size });
      return NextResponse.json({ results, partialFailure: results.some(result => !result.ok) && results.some(result => result.ok) });
    }
    const command = Command.parse(raw);
    const auditActor = actor.name || actor.uid;
    if (!(await isVisibleForCpu(request, command.orderId))) throw Object.assign(new Error("CPU delivery is not selected for this booking, so no CPU production work is required."), { status: 422 });
    const storedPlan = await planRepository.get(command.orderId);
    if (!storedPlan && !isLocalRuntime()) plans.delete(command.orderId);
    const plan = await getPlan(request, command.orderId, storedPlan);
    const currentOrder = await loadOrder(request, command.orderId);
    if (!currentOrder) throw Object.assign(new Error("The canonical Production Order could not be loaded."), { status: 503 });
    const expectedUpdatedAt = storedPlan?.updatedAt;
    const timestamp = now();
    let notification: { status: string; reason?: string } | undefined;
    if (command.action === "accept") {
      plan.status = "planning"; plan.acceptedBy = auditActor; plan.acceptedAt = timestamp; plan.audit.push({ action: "order-accepted", at: timestamp, by: auditActor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "accepted", version: order.version + 1 }));
      await syncCanonicalLifecycle(request, command.orderId, "accepted", "Production chef accepted the governed Production Order.");
      // Local fixture orders remain self-contained. Only a governed Booking
      // hand-off gets the confirmation-email seam, and email failure must not
      // prevent the production chef from accepting the production work.
      if (command.orderId.startsWith("production-order:v1:booking:")) {
        try {
          const order = await productionOrderDetail(request, command.orderId);
          if (order) notification = await hubJson(request, "/api/hospitality/production-confirmation", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ action: "notify-booking-confirmed", sourceBookingId: order.sourceBookingId }) }, (value): value is { status: string; reason?: string } => Boolean(value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string"));
        } catch (error) {
          notification = { status: "failed", reason: `Confirmation email could not be prepared: ${(error as Error).message}` };
        }
      }
    }
    if (command.action === "reject") { plan.status = "rejected"; plan.rejectionReason = command.reason; plan.audit.push({ action: "order-rejected", at: timestamp, by: auditActor, reason: command.reason }); updateLocalFixture(command.orderId, order => ({ ...order, status: "rejected", version: order.version + 1 })); }
    if (command.action === "reject") await syncCanonicalLifecycle(request, command.orderId, "rejected", command.reason);
    if (command.action === "clarify") { plan.status = "needs_clarification"; plan.clarificationNote = command.note; plan.audit.push({ action: "clarification-requested", at: timestamp, by: auditActor, reason: command.note }); updateLocalFixture(command.orderId, order => ({ ...order, status: "needs_clarification", version: order.version + 1 })); }
    if (command.action === "clarify") await syncCanonicalLifecycle(request, command.orderId, "needs_clarification", command.note);
    if (command.action === "save-plan") {
      const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: command.menuItems }).menuItems }, command.orderId)).menuItems;
      const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
      const matchesSignedCheckpoint = plan.signedMenuContentHash === menuContentHash(nextMenuItems);
      plan.status = matchesSignedCheckpoint ? "planned" : "planning";
      plan.menuItems = nextMenuItems;
      plan.planningNotes = command.planningNotes;
      if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else {
        if (contentChanged) revokeCurrentAllergenRelease(plan, auditActor, timestamp);
        plan.signatures = undefined;
        plan.matrixArtifact = undefined; plan.masterMatrixArtifact = undefined; plan.siteMatrixArtifacts = undefined;
      }
      plan.audit.push({ action: "plan-saved", at: timestamp, by: auditActor });
      updateLocalFixture(command.orderId, order => ({ ...order, status: "planning", version: order.version + 1 }));
    }
    if (command.action === "mark-planned") {
      const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: command.menuItems }).menuItems }, command.orderId)).menuItems;
      const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
      const matchesSignedCheckpoint = plan.signedMenuContentHash === menuContentHash(nextMenuItems);
      plan.menuItems = nextMenuItems;
      plan.planningNotes = command.planningNotes;
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
      if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else if (contentChanged) {
        revokeCurrentAllergenRelease(plan, auditActor, timestamp);
        plan.signatures = undefined;
        plan.matrixArtifact = undefined; plan.masterMatrixArtifact = undefined; plan.siteMatrixArtifacts = undefined;
      }
      plan.status = "planned"; plan.audit.push({ action: "plan-marked-planned", at: timestamp, by: auditActor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "planned", version: order.version + 1 }));
      await syncCanonicalLifecycle(request, command.orderId, "planned", "Production plan marked Planned by the production chef.");
    }
    if (command.action === "sign-matrix") {
      if (plan.status !== "planned" && plan.status !== "planning") throw Object.assign(new Error("The allergen matrix is not available for signing."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before signing the matrix."), { status: 422 });
      plan.status = "planned";
      const currentMenuContentHash = menuContentHash(plan.menuItems);
      const currentSignatureScope = matrixSignatureScope(currentOrder, currentMenuContentHash);
      if (!currentSignatureScope) throw Object.assign(new Error("The current published Menu Planning source identity is unavailable; the matrix cannot be signed."), { status: 503 });
      // Legacy signatures without exact publication/day/content lineage are
      // historical evidence only and must never make the current matrix look
      // signed. They remain in the audit trail and are not deleted here.
      const signatures = (plan.signatures || []).filter(signature => signatureMatchesScope(signature, currentSignatureScope));
      plan.signatures = signatures;
      if (signatures.some(signature => signature.role === "production_chef") && signatures.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("This allergen matrix is already fully signed and locked."), { status: 409 });
      if (signatures.some(signature => signature.role === command.role)) throw Object.assign(new Error("This signatory role has already signed this matrix."), { status: 409 });
      if (signatures.length > 0 && plan.signedMenuContentHash && plan.signedMenuContentHash !== currentMenuContentHash) throw Object.assign(new Error("The allergen matrix changed after the first signature. Re-review the matrix before signing again."), { status: 409 });
      const signature: InternalMatrixSignature = { role: command.role, printedName: command.printedName, signedAt: timestamp, actor: auditActor, attestation: command.attestation, signatureDataUrl: command.signatureDataUrl, scope: currentSignatureScope };
      plan.signatures = [...signatures, signature];
      if (signatures.length === 0) plan.signedMenuContentHash = currentMenuContentHash;
      plan.audit.push({ action: "allergen-matrix-signed", at: timestamp, by: auditActor, reason: `${command.role}: ${command.attestation}` });
      const fullySigned = plan.signatures.some(item => item.role === "production_chef") && plan.signatures.some(item => item.role === "head_chef_site_manager");
      if (fullySigned) {
        plan.audit.push({ action: "allergen-matrix-signature-complete", at: timestamp, by: auditActor, reason: "Both required signatures recorded; final matrix persistence started." });
        let artifact: Awaited<ReturnType<typeof createMatrixArtifact>>;
        try {
          artifact = await createMatrixArtifact(plan, command.orderId, auditActor, timestamp, request);
        } catch (error) {
          // The second signature is authoritative even when a downstream PDF or
          // Drive dependency is unavailable. Persist it before returning the
          // failure so the signer is not asked to sign again; the normal retry
          // path can finish artifact publication with both signatures present.
          plan.audit.push({ action: "allergen-matrix-artifact-failed", at: timestamp, by: auditActor, reason: error instanceof Error ? error.message : "Final allergen artifact generation failed." });
          plan.updatedAt = timestamp; plan.updatedBy = auditActor;
          await persistPlan(plan, expectedUpdatedAt);
          throw error;
        }
        if (artifact) {
          const signedOrder = await loadOrder(request, command.orderId);
          const serviceDate = signedOrder?.serviceDate || signedOrder?.requiredBy.slice(0, 10);
          if (!serviceDate) throw Object.assign(new Error("The signed allergen release requires a service date."), { status: 422 });
          plan.matrixArtifact = artifact;
          plan.signedMenuContentHash = menuContentHash(plan.menuItems);
          plan.signedSignatures = plan.signatures;
          plan.signedMatrixArtifact = artifact;
          const previousRelease = [...(plan.allergenReleaseHistory || [])].at(-1);
          const release = buildCpuAllergenRelease({
            serviceDate,
            sourceDayId: signedOrder?.sourceEntityId || "",
            sourcePublicationId: (signedOrder as (typeof signedOrder & { sourcePublicationId?: string }) | undefined)?.sourcePublicationId,
            sourcePublicationDayId: signedOrder?.sourcePublicationDayId || "",
            sourceVersion: signedOrder?.sourceVersion || 0,
            sourceContentHash: signedOrder?.sourceContentHash || "",
            version: Math.max(1, ...((plan.allergenReleaseHistory || []).map(item => item.version + 1))),
            signedAt: timestamp,
            signatures: plan.signatures,
            items: plan.menuItems,
            masterArtifact: plan.masterMatrixArtifact || artifact,
            derivedArtifacts: Object.values(plan.siteMatrixArtifacts || {}),
            packetArtifacts: Object.values(plan.siteMatrixArtifacts || {}).filter(item => item.packetContentHash && item.packetObjectName).map(item => ({ ...item, contentHash: item.packetContentHash! })),
            previous: previousRelease,
          });
          plan.currentAllergenRelease = publishCpuAllergenRelease(undefined, release).current;
          plan.audit.push({ action: "allergen-matrix-saved", at: timestamp, by: auditActor, reason: "Final signed matrix persisted to the configured Drive workspace." });
        } else {
          plan.audit.push({ action: "allergen-matrix-storage-not-configured", at: timestamp, by: auditActor, reason: "Drive persistence is intentionally deferred; the signed workflow remains complete without a persisted artifact." });
        }
      }
    }
    if (command.action === "save-matrix") {
      if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
      if (!plan.signatures?.some(signature => signature.role === "production_chef") || !plan.signatures?.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("Both required signatures must be recorded before generating the allergen matrix PDF."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before saving the matrix."), { status: 422 });
      const artifact = await createMatrixArtifact(plan, command.orderId, auditActor, timestamp, request);
      if (!artifact) throw Object.assign(new Error("Matrix storage not configured."), { status: 503 });
      plan.matrixArtifact = artifact;
      plan.signedMenuContentHash = menuContentHash(plan.menuItems);
      plan.signedSignatures = plan.signatures;
      plan.signedMatrixArtifact = plan.matrixArtifact;
      if (!plan.currentAllergenRelease) {
        const signedOrder = await loadOrder(request, command.orderId);
        const serviceDate = signedOrder?.serviceDate || signedOrder?.requiredBy.slice(0, 10);
        if (!serviceDate) throw Object.assign(new Error("The signed allergen release requires a service date."), { status: 422 });
        const previousRelease = [...(plan.allergenReleaseHistory || [])].at(-1);
        const release = buildCpuAllergenRelease({
          serviceDate,
          sourceDayId: signedOrder?.sourceEntityId || "",
          sourcePublicationId: (signedOrder as (typeof signedOrder & { sourcePublicationId?: string }) | undefined)?.sourcePublicationId,
          sourcePublicationDayId: signedOrder?.sourcePublicationDayId || "",
          sourceVersion: signedOrder?.sourceVersion || 0,
          sourceContentHash: signedOrder?.sourceContentHash || "",
          version: Math.max(1, ...((plan.allergenReleaseHistory || []).map(item => item.version + 1))),
          signedAt: timestamp,
          signatures: plan.signatures,
          items: plan.menuItems,
          masterArtifact: plan.masterMatrixArtifact || artifact,
          derivedArtifacts: Object.values(plan.siteMatrixArtifacts || {}),
          packetArtifacts: Object.values(plan.siteMatrixArtifacts || {}).filter(item => item.packetContentHash && item.packetObjectName).map(item => ({ ...item, contentHash: item.packetContentHash! })),
          previous: previousRelease,
        });
        plan.currentAllergenRelease = publishCpuAllergenRelease(undefined, release).current;
      }
      plan.audit.push({ action: "allergen-matrix-saved", at: timestamp, by: auditActor, reason: "Final signed matrix persisted to the configured Drive workspace." });
    }
    plan.updatedAt = timestamp; plan.updatedBy = auditActor;
    await persistPlan(plan, expectedUpdatedAt);
    const changedOrder = await loadOrder(request, command.orderId);
    const releaseForEvent = plan.currentAllergenRelease || (command.action === "save-plan" || command.action === "mark-planned" ? plan.allergenReleaseHistory?.at(-1) : undefined);
    if (releaseForEvent && changedOrder?.destinationOplocId) await notifyDeliveredInAllergenRelease({ eventType: plan.currentAllergenRelease?.status === "current" ? "published" : "revoked", release: releaseForEvent, oplocId: changedOrder.destinationOplocId });
    recordDeliveredInReadBudget({ stage: "plan_post_mutation", canonicalOrderDocs: changedOrder ? 1 : 0, planDocs: 1, selectedIds: 1 });
    if (changedOrder?.serviceDate) {
      const event = await appendCpuChange({ serviceDate: changedOrder.serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: command.action, actorId: actor.uid, changedAt: timestamp });
      await rebuildCpuDayProjection(request, changedOrder.serviceDate, event.sequence);
      await rebuildCpuWeekProjection(request, weekCommencingFor(changedOrder.serviceDate), event.sequence);
      const review = changedOrder.destinationOplocId ? await rebuildCpuReviewPackage(request, changedOrder.serviceDate, changedOrder.destinationOplocId, event.sequence) : undefined;
      await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${event.sequence}`, sourceEntityId: plan.id, serviceDate: changedOrder.serviceDate, sourceVersion: event.sequence, changedAt: timestamp, changeType: eventTypeForConsumers(command.action), order: changedOrder, logistics: false, ...(review ? { reviewManifest: review.manifest } : {}) });
    }
    const matrixStatus = plan.matrixArtifact ? "ready" : plan.signatures?.some(signature => signature.role === "production_chef") && plan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? changedOrder && !matrixDriveConfiguration(changedOrder).enabled ? "not_configured" : "generating" : undefined;
    return NextResponse.json({ plan, matrixArtifact: plan.matrixArtifact ?? null, signatures: plan.signatures ?? null, matrixStatus, notification: notification || (plan.status === "planned" ? { title: "New production plan ready for menu generation.", orderId: plan.orderId } : undefined) });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
