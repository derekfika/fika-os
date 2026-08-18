import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import type { AllergenCellState, InternalMatrixSignature, PlannedMenuItem, ProductionPlan } from "../../lib/production-plan";
import { allergenMatrixHtml } from "../../ui/allergen-matrix";
import { renderPdfLocally } from "../../lib/local-pdf";
import { notifyBookingConfirmedForProductionOrder } from "@hub/lib/hospitality-booking-service";
import {
  productionOrderDetail,
  transitionProductionOrder,
  type ProductionStatus,
  type ProductionOrder,
} from "@hub/lib/production-domain";

export const dynamic = "force-dynamic";

const canonicalCpuActor = {
  uid: "local-cpu",
  name: "Production chef (local)",
  role: "integration-admin" as const,
  synthetic: true as const,
};

async function syncCanonicalLifecycle(
  orderId: string,
  target: "accepted" | "planned" | "rejected" | "needs_clarification",
  reason: string,
) {
  if (orderId.startsWith("production-order:v1:fixture:")) return undefined;
  let order = await productionOrderDetail(orderId);
  if (!order) return undefined;
  const step = async (status: ProductionStatus) => {
    order = await transitionProductionOrder(
      canonicalCpuActor,
      orderId,
      order!.version,
      status,
      reason,
    );
  };
  if (target === "accepted" && order.status === "draft") {
    await step("needs_review");
  }
  if (target === "planned" && order.status === "accepted") {
    await step("planning");
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

const SubItem = z.object({ id: z.string().min(1), name: z.string(), quantity: z.number().positive().nullable(), allergens: z.record(z.string(), z.enum(["clear", "contains", "may_contain"])), mayContainNotes: z.string().optional(), note: z.string(), evidenceStatus: z.enum(["not_completed", "completed", "requires_review"]) });
const MenuItem = z.object({ id: z.string().min(1), sourceLineId: z.string().optional(), name: z.string(), note: z.string(), subItems: z.array(SubItem) });
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), orderId: z.string(), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("reject"), orderId: z.string(), reason: z.string().trim().min(3), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("clarify"), orderId: z.string(), note: z.string().trim().min(3), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("save-plan"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("sign-matrix"), orderId: z.string(), role: z.enum(["production_chef", "head_chef_site_manager"]), printedName: z.string().trim().min(2).max(120), signatureDataUrl: z.string().regex(/^data:image\/png;base64,/).max(500000), attestation: z.string().trim().min(10).max(500), actor: z.string().default("production-chef") }),
  z.object({ action: z.literal("save-matrix"), orderId: z.string(), actor: z.string().default("production-chef") }),
]);

const plans = new Map<string, ProductionPlan>();
// The app is commonly started both from apps/cpu-production and from the
// monorepo root. Resolve the same local plan store in either case so a saved
// Planned state is visible to the dashboard regardless of launch directory.
const storeCandidates = [
  path.join(process.cwd(), "local-data", "cpu-production", "plans.json"),
  path.join(process.cwd(), "apps", "cpu-production", "local-data", "cpu-production", "plans.json"),
];
const storePath = storeCandidates.find(candidate => existsSync(candidate)) || storeCandidates[0];
async function loadPlans() {
  try {
    const saved = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, ProductionPlan>;
    for (const [id, plan] of Object.entries(saved)) plans.set(id, plan);
  } catch { /* first local run */ }
  return plans;
}
async function persistPlans() {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(Object.fromEntries(plans), null, 2), "utf8");
}
function now() { return new Date().toISOString(); }
async function loadOrder(orderId: string) {
  try {
    return await productionOrderDetail(orderId) || localFixtureOrders().find(item => item.canonicalId === orderId);
  } catch {
    return localFixtureOrders().find(item => item.canonicalId === orderId);
  }
}
function initialPlan(orderId: string, order?: Awaited<ReturnType<typeof productionOrderDetail>> | ProductionOrder): ProductionPlan {
  const timestamp = now();
  return { id: `production-plan:${orderId}`, orderId, status: "draft", menuItems: (order?.lines || []).map((line, index) => ({ id: `menu-item:${orderId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:${index + 1}:1`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" }] })), planningNotes: "", updatedAt: timestamp, updatedBy: "local-fixture", audit: [{ action: "plan-created", at: timestamp, by: "local-fixture" }] };
}
async function getPlan(orderId: string) {
  if (!plans.has(orderId)) {
    // Canonical hand-offs are the source of truth. Local fixtures remain a
    // development fallback, but must never be the only seed for a real order.
    const order = await loadOrder(orderId);
    plans.set(orderId, initialPlan(orderId, order));
  }
  return plans.get(orderId)!;
}
function hospitalityBase() { return (process.env.HOSPITALITY_BOOKING_BASE_URL || "http://localhost:3300").replace(/\/$/, ""); }
function siteKey(label?: string) { const value = (label || "").toLowerCase(); return value.includes("angel") ? "angel-court" : value.includes("cfc") ? "cfc" : value.includes("munich") ? "munich-re" : "mnk"; }
async function mergeOriginalItems(plan: ProductionPlan, orderId: string): Promise<ProductionPlan> {
  const order = await loadOrder(orderId);
  if (!order) return plan;
  const existing = new Set(plan.menuItems.map(item => item.sourceLineId || item.id));
  const missing = order.lines.filter(line => !existing.has(line.canonicalId)).map((line, index) => ({ id: `menu-item:${orderId}:original:${index}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:original:${index}`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" as const }] }));
  return missing.length ? { ...plan, menuItems: [...plan.menuItems, ...missing] } : plan;
}

async function createMatrixArtifact(plan: ProductionPlan, orderId: string, actor: string, timestamp: string, request: NextRequest) {
  if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
  const subItems = plan.menuItems.flatMap(item => item.subItems);
  if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before saving the matrix."), { status: 422 });
  const order = (await productionOrderDetail(orderId)) || localFixtureOrders().find(item => item.canonicalId === orderId);
  if (!order) throw Object.assign(new Error("The production order could not be loaded."), { status: 404 });
  const html = allergenMatrixHtml({ clientName: order.clientName, destinationLabel: order.destinationLabel, serviceType: order.serviceType, serviceDate: order.serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems, plan.signatures || []);
  const contentHash = createHash("sha256").update(html).digest("hex");
  if (plan.matrixArtifact?.contentHash === contentHash) return plan.matrixArtifact;
  const fileName = `${(order.serviceDate || order.requiredBy.slice(0, 10))}_${(order.clientName || "booking")}_${(order.destinationLabel || "site")}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_");
  const pdfPath = path.join(path.dirname(storePath), "matrices", fileName);
  let pdfBase64: string | undefined;
  let pdfStatus: "generated" | "unavailable" = "unavailable";
  try { await renderPdfLocally(html, pdfPath); pdfBase64 = (await fs.readFile(pdfPath)).toString("base64"); pdfStatus = "generated"; } catch { /* print-ready HTML remains available */ }
  let driveStatus: "saved" | "not_configured" | "failed" = "not_configured";
  let driveFileId: string | undefined; let driveUrl: string | undefined;
  try {
    const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}) }, body: JSON.stringify({ name: fileName, html, pdfBase64, siteKey: siteKey(order.destinationLabel) }) });
    const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null };
    if (response.ok && body.saved) { driveStatus = "saved"; driveFileId = body.saved.fileId; driveUrl = body.saved.driveUrl; } else if (response.status !== 503) driveStatus = "failed";
  } catch { driveStatus = "failed"; }
  return { id: `allergen-matrix:${orderId}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName, createdAt: timestamp, createdBy: actor, contentHash, html, pdfPath, ...(pdfStatus === "generated" ? { localUrl: `${(process.env.CPU_PUBLIC_BASE_URL || "http://localhost:3400").replace(/\/$/, "")}/api/production-plan?orderId=${encodeURIComponent(orderId)}&download=pdf` } : {}), pdfStatus, ...(driveFileId ? { driveFileId } : {}), ...(driveUrl ? { driveUrl } : {}), driveStatus };
}

export async function GET(request: NextRequest) {
  await loadPlans();
  const entries = [...plans.values()].filter(plan => plan.status === "planned");
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (orderId && request.nextUrl.searchParams.get("download") === "pdf") {
    const artifact = (await getPlan(orderId)).matrixArtifact;
    if (!artifact?.pdfPath || !existsSync(artifact.pdfPath)) return NextResponse.json({ error: { message: "A local PDF has not been generated for this matrix." } }, { status: 404 });
    return new NextResponse(await fs.readFile(artifact.pdfPath), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${artifact.fileName}"` } });
  }
  const visiblePlans = await Promise.all([...plans.values()].map(plan => mergeOriginalItems(plan, plan.orderId)));
  const selectedPlan = orderId ? await mergeOriginalItems(await getPlan(orderId), orderId) : undefined;
  return NextResponse.json({ plan: selectedPlan, plans: visiblePlans, notifications: entries.map(plan => ({ id: `notification:${plan.id}`, title: "New production plan ready for menu generation.", orderId: plan.orderId, plannedItemCount: plan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: plan.updatedAt })), menus: entries.map(plan => ({ planId: plan.id, orderId: plan.orderId, clientSite: localFixtureOrders().find(order => order.canonicalId === plan.orderId)?.destinationLabel || "Site not assigned", items: plan.menuItems.flatMap(item => item.subItems.map(subItem => ({ menuItem: item.name, name: subItem.name, quantity: subItem.quantity, allergens: Object.entries(subItem.allergens).filter(([, state]) => state === "contains").map(([key]) => key), mayContain: Object.entries(subItem.allergens).filter(([, state]) => state === "may_contain").map(([key]) => key) }))) })) });
}

export async function POST(request: NextRequest) {
  try {
    await loadPlans();
    const command = Command.parse(await request.json());
    const plan = await getPlan(command.orderId);
    const timestamp = now();
    let notification: { status: string; reason?: string } | undefined;
    if (command.action === "accept") {
      plan.status = "planning"; plan.acceptedBy = command.actor; plan.acceptedAt = timestamp; plan.audit.push({ action: "order-accepted", at: timestamp, by: command.actor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "accepted", version: order.version + 1 }));
      await syncCanonicalLifecycle(command.orderId, "accepted", "Production chef accepted the governed Production Order.");
      // Local fixture orders remain self-contained. Only a governed Booking
      // hand-off gets the confirmation-email seam, and email failure must not
      // prevent the production chef from accepting the production work.
      if (command.orderId.startsWith("production-order:v1:booking:")) {
        try {
          const order = await productionOrderDetail(command.orderId);
          if (order) notification = await notifyBookingConfirmedForProductionOrder(order.sourceBookingId);
        } catch (error) {
          notification = { status: "failed", reason: `Confirmation email could not be prepared: ${(error as Error).message}` };
        }
      }
    }
    if (command.action === "reject") { plan.status = "rejected"; plan.rejectionReason = command.reason; plan.audit.push({ action: "order-rejected", at: timestamp, by: command.actor, reason: command.reason }); updateLocalFixture(command.orderId, order => ({ ...order, status: "rejected", version: order.version + 1 })); }
    if (command.action === "reject") await syncCanonicalLifecycle(command.orderId, "rejected", command.reason);
    if (command.action === "clarify") { plan.status = "needs_clarification"; plan.clarificationNote = command.note; plan.audit.push({ action: "clarification-requested", at: timestamp, by: command.actor, reason: command.note }); updateLocalFixture(command.orderId, order => ({ ...order, status: "needs_clarification", version: order.version + 1 })); }
    if (command.action === "clarify") await syncCanonicalLifecycle(command.orderId, "needs_clarification", command.note);
    if (command.action === "save-plan") { plan.status = "planning"; plan.menuItems = (await mergeOriginalItems({ ...plan, menuItems: command.menuItems }, command.orderId)).menuItems; plan.planningNotes = command.planningNotes; plan.audit.push({ action: "plan-saved", at: timestamp, by: command.actor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "planning", version: order.version + 1 })); }
    if (command.action === "mark-planned") {
      plan.menuItems = (await mergeOriginalItems({ ...plan, menuItems: command.menuItems }, command.orderId)).menuItems;
      plan.planningNotes = command.planningNotes;
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
      plan.status = "planned"; plan.audit.push({ action: "plan-marked-planned", at: timestamp, by: command.actor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "planned", version: order.version + 1 }));
      await syncCanonicalLifecycle(command.orderId, "planned", "Production plan marked Planned by the production chef.");
    }
    if (command.action === "sign-matrix") {
      if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before signing it."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before signing the matrix."), { status: 422 });
      const signatures = plan.signatures || [];
      if (signatures.some(signature => signature.role === command.role)) throw Object.assign(new Error("This signatory role has already signed this matrix."), { status: 409 });
      const signature: InternalMatrixSignature = { role: command.role, printedName: command.printedName, signedAt: timestamp, actor: command.actor, attestation: command.attestation, signatureDataUrl: command.signatureDataUrl };
      plan.signatures = [...signatures, signature];
      plan.audit.push({ action: "allergen-matrix-signed", at: timestamp, by: command.actor, reason: `${command.role}: ${command.attestation}` });
      plan.matrixArtifact = await createMatrixArtifact(plan, command.orderId, command.actor, timestamp, request);
      plan.audit.push({ action: "allergen-matrix-archived", at: timestamp, by: command.actor, reason: plan.matrixArtifact.driveStatus === "saved" ? "Signed matrix saved to the configured site Drive folder." : "Signed matrix retained locally; Drive archival requires attention." });
    }
    if (command.action === "save-matrix") {
      if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every named sub-item and allergen check before saving the matrix."), { status: 422 });
      const order = (await productionOrderDetail(command.orderId)) || localFixtureOrders().find(item => item.canonicalId === command.orderId);
      if (!order) throw Object.assign(new Error("The production order could not be loaded."), { status: 404 });
      const html = allergenMatrixHtml({ clientName: order.clientName, destinationLabel: order.destinationLabel, serviceType: order.serviceType, serviceDate: order.serviceDate, serviceWindow: order.serviceWindow, requiredBy: order.requiredBy }, plan.menuItems, plan.signatures || []);
      const contentHash = createHash("sha256").update(html).digest("hex");
      if (plan.matrixArtifact?.contentHash === contentHash) return NextResponse.json({ plan, matrixArtifact: plan.matrixArtifact });
      const fileName = `${(order.serviceDate || order.requiredBy.slice(0, 10))}_${(order.clientName || "booking")}_${(order.destinationLabel || "site")}_Allergen-Matrix.pdf`.replace(/[^A-Za-z0-9._-]+/g, "_");
      const pdfPath = path.join(path.dirname(storePath), "matrices", fileName);
      let pdfBase64: string | undefined;
      let pdfStatus: "generated" | "unavailable" = "unavailable";
      try { await renderPdfLocally(html, pdfPath); pdfBase64 = (await fs.readFile(pdfPath)).toString("base64"); pdfStatus = "generated"; } catch { /* print-ready HTML remains available */ }
      let driveStatus: "saved" | "not_configured" | "failed" = "not_configured";
      let driveFileId: string | undefined; let driveUrl: string | undefined;
      try {
        const response = await fetch(`${hospitalityBase()}/api/allergen-matrix/drive`, { method: "POST", headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}) }, body: JSON.stringify({ name: fileName, html, pdfBase64, siteKey: siteKey(order.destinationLabel) }) });
        const body = await response.json() as { saved?: { fileId?: string; driveUrl?: string } | null };
        if (response.ok && body.saved) { driveStatus = "saved"; driveFileId = body.saved.fileId; driveUrl = body.saved.driveUrl; } else if (response.status !== 503) driveStatus = "failed";
      } catch { driveStatus = "not_configured"; }
      plan.matrixArtifact = { id: `allergen-matrix:${command.orderId}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName, createdAt: timestamp, createdBy: command.actor, contentHash, html, pdfPath, ...(pdfStatus === "generated" ? { localUrl: `${(process.env.CPU_PUBLIC_BASE_URL || "http://localhost:3400").replace(/\/$/, "")}/api/production-plan?orderId=${encodeURIComponent(command.orderId)}&download=pdf` } : {}), pdfStatus, ...(driveFileId ? { driveFileId } : {}), ...(driveUrl ? { driveUrl } : {}), driveStatus };
      plan.audit.push({ action: "allergen-matrix-saved", at: timestamp, by: command.actor, reason: driveStatus === "saved" ? "Saved to configured site Drive folder." : "Stored locally; site Drive is not configured." });
    }
    plan.updatedAt = timestamp; plan.updatedBy = command.actor;
    await persistPlans();
    return NextResponse.json({ plan, matrixArtifact: plan.matrixArtifact, notification: notification || (plan.status === "planned" ? { title: "New production plan ready for menu generation.", orderId: plan.orderId } : undefined) });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 400 }); }
}
