import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { z } from "zod";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import type { AllergenCellState, InternalMatrixSignature, PlannedMenuItem, ProductionPlan } from "../../lib/production-plan";
import { allergenMatrixHtml } from "../../ui/allergen-matrix";
import { renderPdfLocally } from "../../lib/local-pdf";
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

function menuContentHash(menuItems: PlannedMenuItem[]) {
  return createHash("sha256").update(JSON.stringify(menuItems)).digest("hex");
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
  z.object({ action: z.literal("sign-matrix"), orderId: z.string(), role: z.enum(["production_chef", "head_chef_site_manager"]), printedName: z.string().trim().min(2).max(120), signatureDataUrl: z.string().regex(/^data:image\/png;base64,/).max(500000), attestation: z.string().trim().min(10).max(500) }),
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
      plans.set(orderId, { ...prior, id: `production-plan:${orderId}`, orderId, status: "draft", menuItems, signatures: undefined, matrixArtifact: undefined, updatedAt: now(), updatedBy: "system", audit: [...prior.audit, { action: "plan-carried-to-amended-order", at: now(), by: "system", reason: "The Booking was amended; prior allergen work was retained as a draft for the replacement CPU order." }] });
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
    if (matchesSignedCheckpoint) { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else { plan.signatures = undefined; plan.matrixArtifact = undefined; }
    plan.audit.push({ action: "plan-saved", at: now(), by: auditActor });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planning", version: current.version + 1 }));
  } else {
    const subItems = plan.menuItems.flatMap(item => item.subItems);
    if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
    if (matchesSignedCheckpoint) { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else if (contentChanged) { plan.signatures = undefined; plan.matrixArtifact = undefined; }
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
  if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before saving the matrix."), { status: 422 });
  const order = await loadOrder(request, orderId);
  if (!order) throw Object.assign(new Error("The production order could not be loaded."), { status: 404 });
  if (!matrixDriveConfiguration(order).enabled) return undefined;
  const html = allergenMatrixHtml({ clientName: order.clientName, destinationLabel: order.destinationLabel, serviceType: order.serviceType, serviceDate: order.serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems, plan.signatures || []);
  const contentHash = createHash("sha256").update(html).digest("hex");
  if (plan.matrixArtifact?.contentHash === contentHash) return plan.matrixArtifact;
  const fileName = `${(order.serviceDate || order.requiredBy.slice(0, 10))}_${(order.clientName || "booking")}_${(order.destinationLabel || "site")}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_");
  const pdfPath = path.join(process.cwd(), "data", "cpu-production", "matrices", fileName);
  let pdfBase64: string | undefined;
  let pdfStatus: "generated" | "unavailable" = "unavailable";
  try { await renderPdfLocally(html, pdfPath); pdfBase64 = (await fs.readFile(pdfPath)).toString("base64"); pdfStatus = "generated"; } catch { /* print-ready HTML remains available */ }
  let driveStatus: "saved" = "saved";
  let driveFileId: string | undefined; let driveUrl: string | undefined;
  try {
    const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) }, body: JSON.stringify({ name: fileName, html, pdfBase64, productionOrderId: orderId, weekCommencing: weekCommencingFor(order.serviceDate || order.requiredBy.slice(0, 10)) }) });
    const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null; error?: { message?: string } };
    if (!response.ok || !body.saved) throw Object.assign(new Error(body.error?.message || "The final allergen matrix could not be persisted to the configured Drive workspace."), { status: response.status || 503 });
    driveStatus = "saved"; driveFileId = body.saved.fileId; driveUrl = body.saved.driveUrl;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    throw Object.assign(new Error("The final allergen matrix could not be persisted to the configured Drive workspace."), { status: 503 });
  }
  return { id: `allergen-matrix:${orderId}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName, createdAt: timestamp, createdBy: actor, contentHash, html, pdfPath, ...(pdfStatus === "generated" ? { localUrl: `${(process.env.CPU_PUBLIC_BASE_URL || "http://localhost:3400").replace(/\/$/, "")}/api/production-plan?orderId=${encodeURIComponent(orderId)}&download=pdf` } : {}), pdfStatus, ...(driveFileId ? { driveFileId } : {}), ...(driveUrl ? { driveUrl } : {}), driveStatus };
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
        for (const oplocId of [...new Set(affectedOrders.map(order => order?.destinationOplocId).filter((id): id is string => Boolean(id)))]) await rebuildCpuReviewPackage(request, serviceDate, oplocId, latestSequenceByDate.get(serviceDate));
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
      const matchesSignedCheckpoint = plan.signedMenuContentHash === menuContentHash(nextMenuItems);
      plan.status = matchesSignedCheckpoint ? "planned" : "planning";
      plan.menuItems = nextMenuItems;
      plan.planningNotes = command.planningNotes;
      if (matchesSignedCheckpoint) {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else {
        // Keep the last signed checkpoint so an accidental allergen touch can
        // be reverted without forcing both chefs to sign the same matrix again.
        plan.signatures = undefined;
        plan.matrixArtifact = undefined;
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
      if (matchesSignedCheckpoint) {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else if (contentChanged) {
        plan.signatures = undefined;
        plan.matrixArtifact = undefined;
      }
      plan.status = "planned"; plan.audit.push({ action: "plan-marked-planned", at: timestamp, by: auditActor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "planned", version: order.version + 1 }));
      await syncCanonicalLifecycle(request, command.orderId, "planned", "Production plan marked Planned by the production chef.");
    }
    if (command.action === "sign-matrix") {
      if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before signing it."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before signing the matrix."), { status: 422 });
      const signatures = plan.signatures || [];
      if (signatures.some(signature => signature.role === "production_chef") && signatures.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("This allergen matrix is already fully signed and locked."), { status: 409 });
      if (signatures.some(signature => signature.role === command.role)) throw Object.assign(new Error("This signatory role has already signed this matrix."), { status: 409 });
      const signature: InternalMatrixSignature = { role: command.role, printedName: command.printedName, signedAt: timestamp, actor: auditActor, attestation: command.attestation, signatureDataUrl: command.signatureDataUrl };
      plan.signatures = [...signatures, signature];
      plan.audit.push({ action: "allergen-matrix-signed", at: timestamp, by: auditActor, reason: `${command.role}: ${command.attestation}` });
      const fullySigned = plan.signatures.some(item => item.role === "production_chef") && plan.signatures.some(item => item.role === "head_chef_site_manager");
      if (fullySigned) {
        plan.audit.push({ action: "allergen-matrix-signature-complete", at: timestamp, by: auditActor, reason: "Both required signatures recorded; final matrix persistence started." });
        const artifact = await createMatrixArtifact(plan, command.orderId, auditActor, timestamp, request);
        if (artifact) {
          plan.matrixArtifact = artifact;
          plan.signedMenuContentHash = menuContentHash(plan.menuItems);
          plan.signedSignatures = plan.signatures;
          plan.signedMatrixArtifact = artifact;
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
      if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before saving the matrix."), { status: 422 });
      const artifact = await createMatrixArtifact(plan, command.orderId, auditActor, timestamp, request);
      if (!artifact) throw Object.assign(new Error("Matrix storage not configured."), { status: 503 });
      plan.matrixArtifact = artifact;
      plan.signedMenuContentHash = menuContentHash(plan.menuItems);
      plan.signedSignatures = plan.signatures;
      plan.signedMatrixArtifact = plan.matrixArtifact;
      plan.audit.push({ action: "allergen-matrix-saved", at: timestamp, by: auditActor, reason: "Final signed matrix persisted to the configured Drive workspace." });
    }
    plan.updatedAt = timestamp; plan.updatedBy = auditActor;
    await persistPlan(plan, expectedUpdatedAt);
    const changedOrder = await loadOrder(request, command.orderId);
    recordDeliveredInReadBudget({ stage: "plan_post_mutation", canonicalOrderDocs: changedOrder ? 1 : 0, planDocs: 1, selectedIds: 1 });
    if (changedOrder?.serviceDate) {
      const event = await appendCpuChange({ serviceDate: changedOrder.serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: command.action, actorId: actor.uid, changedAt: timestamp });
      await rebuildCpuDayProjection(request, changedOrder.serviceDate, event.sequence);
      await rebuildCpuWeekProjection(request, weekCommencingFor(changedOrder.serviceDate), event.sequence);
      if (changedOrder.destinationOplocId) await rebuildCpuReviewPackage(request, changedOrder.serviceDate, changedOrder.destinationOplocId, event.sequence);
    }
    const matrixStatus = plan.matrixArtifact ? "ready" : plan.signatures?.some(signature => signature.role === "production_chef") && plan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? changedOrder && !matrixDriveConfiguration(changedOrder).enabled ? "not_configured" : "generating" : undefined;
    return NextResponse.json({ plan, matrixArtifact: plan.matrixArtifact ?? null, signatures: plan.signatures ?? null, matrixStatus, notification: notification || (plan.status === "planned" ? { title: "New production plan ready for menu generation.", orderId: plan.orderId } : undefined) });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
