import type { NextRequest } from "next/server";
import { productionQueue, productionQueueForWeek } from "./production-http-client";
import { withReadableDestinations } from "./cpu-oploc-labels";
import { appendCpuChange as appendProjectionChange, cpuChanges, cpuProjections, loadPlansForOrders } from "./cpu-projection-repository";
import { recordDeliveredInReadBudget } from "./delivered-in-read-budget";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { ReadPackageManifest } from "@fika/server-shared/read-package";
export { cpuProjections } from "./cpu-projection-repository";
import type { ProductionLine, ProductionOrder, ProductionStatus } from "./production-types";
import type { ProductionPlan } from "../app/lib/production-plan";
import { publishCpuProjectionPackage } from "./cpu-read-package";

export type CpuChangeEvent = { sequence: number; serviceDate: string; entityType: "productionOrder" | "productionPlan"; entityId: string; revision: number; changeType: string; actorId: string; changedAt: string; idempotencyKey?: string };
export type CpuProjectionLine = { sourceLineId: string; sourceBookingLineId?: string; sourceMenuItemId?: string; name: string; quantity: number; unit: string; productionQuantity?: number; productionUnit?: string; dietaries: Record<string, unknown>; allergenEvidenceStatus?: ProductionLine["allergenEvidenceStatus"]; approvedAllergenSnapshot?: ProductionLine["approvedAllergenSnapshot"]; notes?: string };
export type CpuProjectionOrder = { id: string; serviceDate: string; requiredBy: string; serviceWindow: ProductionOrder["serviceWindow"]; origin?: string; sourceReference?: string; sourceEntityId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string; destinationOplocId?: string; destinationLabel?: string; clientName?: string; serviceType?: string; productionCategory?: ProductionOrder["productionCategory"]; requiresDelivery?: boolean; pax?: number; priority: ProductionOrder["priority"]; status: ProductionStatus; workflowStatus?: ProductionStatus; cancellationNotice?: string; productionScope?: string; quantities: CpuProjectionLine[]; bookingDietaries?: Record<string, unknown>; bookingNotes?: string; allergenReadiness: string; planningReadiness: string; attention: string[]; version: number };
export type CpuDayProjection = { serviceDate: string; revision: number; lastChangeSequence: number; orders: CpuProjectionOrder[]; summary: { orders: number; ready: number; attention: number; planned: number; totalUnits: number }; rebuiltAt: string };
export type CpuWeekProjection = { serviceDate: string; weekCommencing: string; revision: number; lastChangeSequence: number; orders: CpuProjectionOrder[]; summary: CpuDayProjection["summary"]; rebuiltAt: string };
export const appendCpuChange = (input: Omit<CpuChangeEvent, "sequence">) => appendProjectionChange(input);
export async function listCpuChanges(after: number, serviceDate: string) { const snapshot = await cpuChanges().where("serviceDate", "==", serviceDate).where("sequence", ">", after).orderBy("sequence", "asc").get(); recordDataAccess({ app: "cpu-production", operation: "changes.service-date", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" }); return snapshot.docs.map((doc) => doc.data() as CpuChangeEvent); }
export function weekCommencingFor(serviceDate: string) { const date = new Date(`${serviceDate}T00:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
function weekDates(weekCommencing: string) { const start = new Date(`${weekCommencing}T00:00:00Z`); return Array.from({ length: 5 }, (_, index) => { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); return date.toISOString().slice(0, 10); }); }
export async function listCpuWeekChanges(after: number, weekCommencing: string) {
  const changes = await Promise.all(weekDates(weekCommencing).map((serviceDate) => listCpuChanges(after, serviceDate)));
  return changes.flat().sort((a, b) => a.sequence - b.sequence);
}
export function buildCpuDayProjection(serviceDate: string, orders: ProductionOrder[], plans: ProductionPlan[] = [], lastChangeSequence = 0, revision = 1, now = new Date().toISOString()): CpuDayProjection {
  const planByOrder = new Map(plans.map((plan) => [plan.orderId, plan]));
  const signedPublicationDays = new Set(plans.filter(plan => plan.status === "planned" && plan.currentAllergenRelease?.status === "current" && plan.signatures?.some(signature => signature.role === "production_chef") && plan.signatures?.some(signature => signature.role === "head_chef_site_manager")).flatMap(plan => orders.filter(order => order.canonicalId === plan.orderId).map(order => order.sourcePublicationDayId).filter((id): id is string => Boolean(id))));
  const projected = orders.filter((order) => (serviceDate === "all" || order.serviceDate === serviceDate) && !order.supersededBy && (order.status !== "cancelled" || Boolean((order.cancellationNotice || order.origin === "hospitality_booking") && !order.cpuDismissedAt))).map((order) => { const plan = planByOrder.get(order.canonicalId); const sharedPublicationDaySigned = order.origin === "menu_planning" && Boolean(order.sourcePublicationDayId && signedPublicationDays.has(order.sourcePublicationDayId)); const workflowStatus = sharedPublicationDaySigned ? "planned" : plan?.status === "planned" ? "planned" : plan?.status === "planning" ? "planning" : order.workflowStatus; const cancellationNotice = order.cancellationNotice || (order.status === "cancelled" && order.origin === "hospitality_booking" ? "Booking cancelled in Manager dashboard." : undefined); const attention = [...(cancellationNotice ? [cancellationNotice] : []), ...order.exceptions.filter((item) => item.status === "open").map((item) => item.description), ...(order.lines.some((line) => line.allergenEvidenceStatus === "missing" || line.allergenEvidenceStatus === "conflicting") ? ["Allergen evidence needs attention"] : [])]; const quantities = order.lines.map((line) => ({ sourceLineId: line.canonicalId, ...(line.sourceBookingLineId ? { sourceBookingLineId: line.sourceBookingLineId } : {}), ...(line.sourceMenuItemId ? { sourceMenuItemId: line.sourceMenuItemId } : {}), name: line.itemName, quantity: line.customerQuantity, unit: line.customerUnit, ...(line.productionQuantity !== undefined ? { productionQuantity: line.productionQuantity } : {}), ...(line.productionUnit ? { productionUnit: line.productionUnit } : {}), dietaries: line.dietaries || {}, ...(line.allergenEvidenceStatus ? { allergenEvidenceStatus: line.allergenEvidenceStatus } : {}), ...(line.approvedAllergenSnapshot ? { approvedAllergenSnapshot: line.approvedAllergenSnapshot } : {}), ...(line.productionInstructions || line.description || line.servingGuidance ? { notes: [line.productionInstructions, line.description, line.servingGuidance].filter(Boolean).join(" · ") } : {}) })); return { id: order.canonicalId, serviceDate: order.serviceDate || serviceDate, requiredBy: order.requiredBy, serviceWindow: order.serviceWindow, origin: order.origin, sourceReference: order.sourceBookingId, ...(order.sourceEntityId ? { sourceEntityId: order.sourceEntityId } : {}), ...(order.sourcePublicationDayId ? { sourcePublicationDayId: order.sourcePublicationDayId } : {}), ...(order.sourceVersion !== undefined ? { sourceVersion: order.sourceVersion } : {}), ...(order.sourceContentHash ? { sourceContentHash: order.sourceContentHash } : {}), ...(order.destinationOplocId ? { destinationOplocId: order.destinationOplocId } : {}), destinationLabel: order.destinationLabel || order.destinationOplocId, ...(order.clientName ? { clientName: order.clientName } : {}), ...(order.serviceType ? { serviceType: order.serviceType } : {}), ...(order.productionCategory ? { productionCategory: order.productionCategory } : {}), ...(order.requiresDelivery !== undefined ? { requiresDelivery: order.requiresDelivery } : {}), pax: order.guestCount, priority: order.priority, status: order.status, workflowStatus, ...(cancellationNotice ? { cancellationNotice } : {}), productionScope: order.lines.map((line) => line.workstream).filter(Boolean).join(",") || "unassigned", quantities, ...(order.bookingDietaries ? { bookingDietaries: order.bookingDietaries } : {}), ...(order.bookingNotes ? { bookingNotes: order.bookingNotes } : {}), allergenReadiness: attention.some((item) => item.toLowerCase().includes("allergen")) ? "attention" : "ready", planningReadiness: workflowStatus === "planned" ? "planned" : order.status === "ready" || order.status === "in_production" || order.status === "complete" ? "ready" : "attention", attention, version: order.version }; });
  return { serviceDate, revision, lastChangeSequence, orders: projected, summary: { orders: projected.length, ready: projected.filter((order) => order.planningReadiness === "ready").length, attention: projected.filter((order) => order.attention.length > 0).length, planned: projected.filter((order) => order.workflowStatus === "planned").length, totalUnits: projected.reduce((sum, order) => sum + order.quantities.reduce((total, item) => total + item.quantity, 0), 0) }, rebuiltAt: now };
}

export async function rebuildCpuDayProjection(request: NextRequest, serviceDate: string, lastChangeSequence?: number) {
  const [rawOrders, previous] = await Promise.all([productionQueue(request, serviceDate), cpuProjections().doc(serviceDate).get()]);
  recordDataAccess({ app: "cpu-production", operation: "projection.by-service-date", source: "FIRESTORE", documents: previous.exists ? 1 : 0, firestoreReadKind: "document" });
  const orders = await withReadableDestinations(request, rawOrders);
  const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
  const projection = buildCpuDayProjection(serviceDate, orders, plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  await cpuProjections().doc(serviceDate).set(projection);
  await publishCpuProjectionPackage(projection);
  recordDeliveredInReadBudget({ stage: "day_projection_rebuild", projectionDocs: 1, selectedIds: orders.length, rebuildScopes: 1 });
  return projection;
}

export async function rebuildCpuWeekProjection(request: NextRequest, weekCommencing: string, lastChangeSequence?: number) {
  const [rawOrders, previous] = await Promise.all([productionQueueForWeek(request, weekCommencing), cpuProjections().doc(`week:${weekCommencing}`).get()]);
  recordDataAccess({ app: "cpu-production", operation: "projection.by-week", source: "FIRESTORE", documents: previous.exists ? 1 : 0, firestoreReadKind: "document" });
  const orders = await withReadableDestinations(request, rawOrders);
  const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
  const projection = buildCpuDayProjection("all", orders.filter((order) => order.serviceDate && weekDates(weekCommencing).includes(order.serviceDate)), plans, lastChangeSequence ?? Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
  const week: CpuWeekProjection = { serviceDate: weekCommencing, weekCommencing, revision: projection.revision, lastChangeSequence: projection.lastChangeSequence, orders: projection.orders, summary: projection.summary, rebuiltAt: projection.rebuiltAt };
  await cpuProjections().doc(`week:${weekCommencing}`).set(week);
  await publishCpuProjectionPackage(week);
  recordDeliveredInReadBudget({ stage: "week_projection_rebuild", projectionDocs: 1, selectedIds: orders.length, rebuildScopes: 1 });
  return week;
}

type EmptyWeekProjectionResult = { projection: CpuWeekProjection; manifest: ReadPackageManifest };
const emptyWeekInitialisationInFlight = new Map<string, Promise<EmptyWeekProjectionResult | undefined>>();
const missingWeekRecoveryInFlight = new Map<string, Promise<EmptyWeekProjectionResult>>();
type ProjectionSnapshot = { exists: boolean; data(): unknown };
export type EmptyWeekInitialisationDependencies = {
  loadOrders: (request: NextRequest, weekCommencing: string) => Promise<ProductionOrder[]>;
  readProjection: (weekCommencing: string) => Promise<ProjectionSnapshot>;
  writeProjection: (weekCommencing: string, projection: CpuWeekProjection) => Promise<void>;
  publishPackage: (projection: CpuWeekProjection) => Promise<ReadPackageManifest>;
};

const defaultEmptyWeekDependencies: EmptyWeekInitialisationDependencies = {
  loadOrders: productionQueueForWeek,
  readProjection: async (weekCommencing) => cpuProjections().doc(`week:${weekCommencing}`).get(),
  writeProjection: async (weekCommencing, projection) => { await cpuProjections().doc(`week:${weekCommencing}`).set(projection); },
  publishPackage: publishCpuProjectionPackage,
};

function isStoredEmptyWeekProjection(value: unknown, weekCommencing: string): value is CpuWeekProjection {
  if (!value || typeof value !== "object") return false;
  const projection = value as Partial<CpuWeekProjection>;
  return projection.serviceDate === weekCommencing
    && projection.weekCommencing === weekCommencing
    && projection.revision !== undefined
    && projection.lastChangeSequence !== undefined
    && Array.isArray(projection.orders)
    && projection.orders.length === 0
    && projection.summary?.orders === 0
    && projection.summary.ready === 0
    && projection.summary.attention === 0
    && projection.summary.planned === 0
    && projection.summary.totalUnits === 0
    && typeof projection.rebuiltAt === "string";
}

/**
 * Initialise only a genuinely empty week after a normal package miss. The
 * canonical source count is checked before projection filtering so cancelled,
 * superseded or otherwise hidden source orders cannot be mistaken for an empty
 * week. A missing package for a non-empty week remains fail-closed.
 */
export async function initialiseEmptyCpuWeekProjection(request: NextRequest, weekCommencing: string, dependencies: EmptyWeekInitialisationDependencies = defaultEmptyWeekDependencies) {
  const existing = emptyWeekInitialisationInFlight.get(weekCommencing);
  if (existing) return existing;
  const initialisation = (async (): Promise<EmptyWeekProjectionResult | undefined> => {
    const rawOrders = await dependencies.loadOrders(request, weekCommencing);
    const sourceOrders = rawOrders.filter((order) => {
      const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
      return weekDates(weekCommencing).includes(serviceDate);
    });
    if (sourceOrders.length > 0) return undefined;

    const previous = await dependencies.readProjection(weekCommencing);
    const stored = previous.data();
    const week = isStoredEmptyWeekProjection(stored, weekCommencing)
      ? stored
      : (() => {
        const projection = buildCpuDayProjection("all", [], [], Number((stored as Partial<CpuWeekProjection> | undefined)?.lastChangeSequence || 0), Number((stored as Partial<CpuWeekProjection> | undefined)?.revision || 0) + 1);
        return { serviceDate: weekCommencing, weekCommencing, revision: projection.revision, lastChangeSequence: projection.lastChangeSequence, orders: [], summary: projection.summary, rebuiltAt: projection.rebuiltAt } satisfies CpuWeekProjection;
      })();
    if (!isStoredEmptyWeekProjection(stored, weekCommencing)) await dependencies.writeProjection(weekCommencing, week);
    const manifest = await dependencies.publishPackage(week);
    recordDeliveredInReadBudget({ stage: "empty_week_projection_initialise", projectionDocs: previous.exists ? 1 : 0, selectedIds: 0, rebuildScopes: 1 });
    return { projection: week, manifest };
  })().finally(() => emptyWeekInitialisationInFlight.delete(weekCommencing));
  emptyWeekInitialisationInFlight.set(weekCommencing, initialisation);
  return initialisation;
}

/** Recover a missing weekly package only after reading the authoritative week. */
export async function recoverMissingCpuWeekProjection(request: NextRequest, weekCommencing: string) {
  const existing = missingWeekRecoveryInFlight.get(weekCommencing);
  if (existing) return existing;
  const recovery = (async (): Promise<EmptyWeekProjectionResult> => {
    const rawOrders = await productionQueueForWeek(request, weekCommencing);
    const sourceOrders = rawOrders.filter((order) => {
      const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
      return weekDates(weekCommencing).includes(serviceDate);
    });
    if (sourceOrders.length === 0) {
      const empty = await initialiseEmptyCpuWeekProjection(request, weekCommencing);
      if (!empty) throw new Error("CPU empty-week recovery changed while initialising.");
      return empty;
    }
    const previous = await cpuProjections().doc(`week:${weekCommencing}`).get();
    const orders = await withReadableDestinations(request, sourceOrders);
    const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
    const built = buildCpuDayProjection("all", orders.filter((order) => order.serviceDate && weekDates(weekCommencing).includes(order.serviceDate)), plans, Number(previous.data()?.lastChangeSequence || 0), Number(previous.data()?.revision || 0) + 1);
    const projection: CpuWeekProjection = { serviceDate: weekCommencing, weekCommencing, revision: built.revision, lastChangeSequence: built.lastChangeSequence, orders: built.orders, summary: built.summary, rebuiltAt: built.rebuiltAt };
    await cpuProjections().doc(`week:${weekCommencing}`).set(projection);
    const manifest = await publishCpuProjectionPackage(projection);
    recordDeliveredInReadBudget({ stage: "week_projection_recovery", projectionDocs: previous.exists ? 1 : 0, selectedIds: orders.length, rebuildScopes: 1 });
    return { projection, manifest };
  })().finally(() => missingWeekRecoveryInFlight.delete(weekCommencing));
  missingWeekRecoveryInFlight.set(weekCommencing, recovery);
  return recovery;
}
