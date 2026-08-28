import { productionQueue, type ProductionOrder, type ProductionStatus } from "@hub/lib/production-domain";
import type { ProductionPlan } from "../app/lib/production-plan";
import { db } from "@hub/lib/firebase-admin";
import { getActiveCanonicalOplocLabels } from "@hub/lib/canonical-oplocs";

export type CpuChangeEvent = { sequence: number; serviceDate: string; entityType: "productionOrder" | "productionPlan"; entityId: string; revision: number; changeType: string; actorId: string; changedAt: string; idempotencyKey?: string };
export type CpuProjectionLine = { name: string; quantity: number; unit: string; productionQuantity?: number; productionUnit?: string; dietaries: Record<string, unknown>; notes?: string };
export type CpuProjectionOrder = { id: string; serviceDate: string; requiredBy: string; serviceWindow: ProductionOrder["serviceWindow"]; origin?: string; sourceReference?: string; destinationOplocId?: string; destinationLabel?: string; clientName?: string; serviceType?: string; pax?: number; priority: ProductionOrder["priority"]; status: ProductionStatus; workflowStatus?: ProductionStatus; cancellationNotice?: string; productionScope?: string; quantities: CpuProjectionLine[]; bookingDietaries?: Record<string, unknown>; bookingNotes?: string; allergenReadiness: string; planningReadiness: string; attention: string[]; version: number };
export type CpuDayProjection = { serviceDate: string; revision: number; lastChangeSequence: number; orders: CpuProjectionOrder[]; summary: { orders: number; ready: number; attention: number; planned: number; totalUnits: number }; rebuiltAt: string };
export type CpuWeekProjection = { serviceDate: string; weekCommencing: string; revision: number; lastChangeSequence: number; orders: CpuProjectionOrder[]; summary: CpuDayProjection["summary"]; rebuiltAt: string };
export const cpuPlans = () => db.collection("fikaCpuProductionPlansV1");
export const cpuChanges = () => db.collection("fikaCpuProductionChangesV1");
export const cpuCursor = () => db.collection("fikaCpuProductionChangeCursorV1");
export const cpuProjections = () => db.collection("fikaCpuProductionDayProjectionsV1");
export const cpuChangeReceipts = () => db.collection("fikaCpuProductionChangeReceiptsV1");

export async function appendCpuChange(input: Omit<CpuChangeEvent, "sequence">) { return db.runTransaction(async (transaction) => { const receiptRef = input.idempotencyKey ? cpuChangeReceipts().doc(input.idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")) : undefined; const receipt = receiptRef ? await transaction.get(receiptRef) : undefined; if (receipt?.exists) return receipt.data()?.event as CpuChangeEvent; const ref = cpuCursor().doc("global"); const current = await transaction.get(ref); const sequence = Number(current.data()?.sequence || 0) + 1; const event = { ...input, sequence }; transaction.set(ref, { sequence }); transaction.create(cpuChanges().doc(String(sequence).padStart(20, "0")), event); if (receiptRef) transaction.create(receiptRef, { idempotencyKey: input.idempotencyKey, event }); return event; }); }
export async function listCpuChanges(after: number, serviceDate: string) { const snapshot = await cpuChanges().where("serviceDate", "==", serviceDate).where("sequence", ">", after).orderBy("sequence", "asc").get(); return snapshot.docs.map((doc) => doc.data() as CpuChangeEvent); }
export function weekCommencingFor(serviceDate: string) { const date = new Date(`${serviceDate}T00:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
function weekDates(weekCommencing: string) { const start = new Date(`${weekCommencing}T00:00:00Z`); return Array.from({ length: 5 }, (_, index) => { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); return date.toISOString().slice(0, 10); }); }
export async function listCpuWeekChanges(after: number, weekCommencing: string) {
  const changes = await Promise.all(weekDates(weekCommencing).map((serviceDate) => listCpuChanges(after, serviceDate)));
  return changes.flat().sort((a, b) => a.sequence - b.sequence);
}
export function buildCpuDayProjection(serviceDate: string, orders: ProductionOrder[], plans: ProductionPlan[] = [], lastChangeSequence = 0, revision = 1, now = new Date().toISOString()): CpuDayProjection {
  const planByOrder = new Map(plans.map((plan) => [plan.orderId, plan]));
  const projected = orders.filter((order) => (serviceDate === "all" || order.serviceDate === serviceDate) && !order.supersededBy && (order.status !== "cancelled" || Boolean((order.cancellationNotice || order.origin === "hospitality_booking") && !order.cpuDismissedAt))).map((order) => { const plan = planByOrder.get(order.canonicalId); const workflowStatus = plan?.status === "planned" ? "planned" : plan?.status === "planning" ? "planning" : order.workflowStatus; const cancellationNotice = order.cancellationNotice || (order.status === "cancelled" && order.origin === "hospitality_booking" ? "Booking cancelled in Manager dashboard." : undefined); const attention = [...(cancellationNotice ? [cancellationNotice] : []), ...order.exceptions.filter((item) => item.status === "open").map((item) => item.description), ...(order.lines.some((line) => line.allergenEvidenceStatus === "missing" || line.allergenEvidenceStatus === "conflicting") ? ["Allergen evidence needs attention"] : [])]; const quantities = order.lines.map((line) => ({ name: line.itemName, quantity: line.customerQuantity, unit: line.customerUnit, ...(line.productionQuantity !== undefined ? { productionQuantity: line.productionQuantity } : {}), ...(line.productionUnit ? { productionUnit: line.productionUnit } : {}), dietaries: line.dietaries || {}, ...(line.productionInstructions || line.description || line.servingGuidance ? { notes: [line.productionInstructions, line.description, line.servingGuidance].filter(Boolean).join(" · ") } : {}) })); return { id: order.canonicalId, serviceDate: order.serviceDate || serviceDate, requiredBy: order.requiredBy, serviceWindow: order.serviceWindow, origin: order.origin, sourceReference: order.sourceBookingId, destinationOplocId: order.destinationOplocId, destinationLabel: order.destinationLabel || order.destinationOplocId, clientName: order.clientName, serviceType: order.serviceType, pax: order.guestCount, priority: order.priority, status: order.status, workflowStatus, ...(cancellationNotice ? { cancellationNotice } : {}), productionScope: order.lines.map((line) => line.workstream).filter(Boolean).join(",") || "unassigned", quantities, ...(order.bookingDietaries ? { bookingDietaries: order.bookingDietaries } : {}), ...(order.bookingNotes ? { bookingNotes: order.bookingNotes } : {}), allergenReadiness: attention.some((item) => item.toLowerCase().includes("allergen")) ? "attention" : "ready", planningReadiness: workflowStatus === "planned" ? "planned" : order.status === "ready" || order.status === "in_production" || order.status === "complete" ? "ready" : "attention", attention, version: order.version }; });
  return { serviceDate, revision, lastChangeSequence, orders: projected, summary: { orders: projected.length, ready: projected.filter((order) => order.planningReadiness === "ready").length, attention: projected.filter((order) => order.attention.length > 0).length, planned: projected.filter((order) => order.workflowStatus === "planned").length, totalUnits: projected.reduce((sum, order) => sum + order.quantities.reduce((total, item) => total + item.quantity, 0), 0) }, rebuiltAt: now };
}

async function withReadableDestinations(orders: ProductionOrder[]) {
  if (!orders.length) return orders;
  const labels = await getActiveCanonicalOplocLabels(orders.map(order => order.destinationOplocId || ""));
  return orders.map(order => {
    const id = order.destinationOplocId;
    const label = id ? labels.get(id) : undefined;
    if (!id || !label) return order;
    const current = order.destinationLabel?.trim();
    if (!current || current === id) return { ...order, destinationLabel: label };
    if (current.startsWith(`${id} · `)) return { ...order, destinationLabel: `${label} · ${current.slice(id.length + 3)}` };
    return order;
  });
}

export async function rebuildCpuDayProjection(serviceDate: string, lastChangeSequence?: number) {
  const [rawOrders, planSnapshot, previous] = await Promise.all([productionQueue(serviceDate), cpuPlans().get(), cpuProjections().doc(serviceDate).get()]);
  const orders = await withReadableDestinations(rawOrders);
  const plans = planSnapshot.docs.map((document) => document.data() as ProductionPlan);
  const projection = buildCpuDayProjection(serviceDate, orders, plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  await cpuProjections().doc(serviceDate).set(projection);
  return projection;
}

export async function rebuildCpuWeekProjection(weekCommencing: string, lastChangeSequence?: number) {
  const [rawOrders, planSnapshot, previous] = await Promise.all([productionQueue(), cpuPlans().get(), cpuProjections().doc(`week:${weekCommencing}`).get()]);
  const orders = await withReadableDestinations(rawOrders);
  const plans = planSnapshot.docs.map((document) => document.data() as ProductionPlan);
  const projection = buildCpuDayProjection("all", orders.filter((order) => order.serviceDate && weekDates(weekCommencing).includes(order.serviceDate)), plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  const week: CpuWeekProjection = { serviceDate: weekCommencing, weekCommencing, revision: projection.revision, lastChangeSequence: projection.lastChangeSequence, orders: projection.orders, summary: projection.summary, rebuiltAt: projection.rebuiltAt };
  await cpuProjections().doc(`week:${weekCommencing}`).set(week);
  return week;
}
