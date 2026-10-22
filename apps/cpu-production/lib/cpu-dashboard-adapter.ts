import type { ProductionOrder, ProductionLine } from "./production-types";
import type { CpuDayProjection } from "./cpu-projection";
import type { ProductionScope } from "./production-scope";
import { europeLondonDate } from "./operational-date";

export function weekCommencingFor(serviceDate: string) { const date = new Date(`${serviceDate}T00:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
export function dashboardOperationalDate(now = new Date()) { const date = new Date(`${europeLondonDate(now)}T12:00:00Z`); const day = date.getUTCDay(); if (day === 0) date.setUTCDate(date.getUTCDate() + 1); else if (day === 6) date.setUTCDate(date.getUTCDate() + 2); return date.toISOString().slice(0, 10); }

/** Rehydrates the compact day read model into the shape used by the existing UI. */
export function cpuProjectionToOrders(projection: CpuDayProjection): ProductionOrder[] {
  return projection.orders.map((row) => {
    const cancellationNotice = row.cancellationNotice || (row.workflowStatus === "cancelled" ? "Booking cancelled in Manager dashboard." : undefined);
    const lines: ProductionLine[] = row.quantities.map((quantity, index) => ({
      canonicalId: quantity.sourceLineId || `${row.id}:projection-line:${index + 1}`,
      sourceBookingLineId: quantity.sourceBookingLineId || quantity.sourceLineId || `${row.id}:projection-line:${index + 1}`,
      ...(quantity.sourceMenuItemId ? { sourceMenuItemId: quantity.sourceMenuItemId } : {}),
      itemName: quantity.name,
      customerQuantity: quantity.quantity,
      customerUnit: quantity.unit,
      productionQuantity: quantity.productionQuantity ?? quantity.quantity,
      productionUnit: quantity.productionUnit || quantity.unit,
      dietaries: quantity.dietaries || {},
      ...(quantity.allergenEvidenceStatus ? { allergenEvidenceStatus: quantity.allergenEvidenceStatus } : {}),
      ...(quantity.approvedAllergenSnapshot ? { approvedAllergenSnapshot: quantity.approvedAllergenSnapshot } : {}),
      ...(quantity.notes ? { productionInstructions: quantity.notes } : {}),
      status: "ready",
      sortOrder: index,
      workstream: (row.productionScope?.split(",")[index] || "unassigned") as ProductionLine["workstream"],
    }));
    return {
      canonicalId: row.id,
      entityType: "Production Order",
      schemaVersion: "projection",
      version: row.version,
      requirementIds: [],
      sourceBookingId: row.sourceReference || row.id,
      sourceQuoteRevisionId: "projection",
      ...(row.destinationOplocId ? { destinationOplocId: row.destinationOplocId } : {}),
      ...(row.destinationLabel ? { destinationLabel: row.destinationLabel } : {}),
      ...(row.sourceEntityId ? { sourceEntityId: row.sourceEntityId } : {}),
      ...(row.sourcePublicationId ? { sourcePublicationId: row.sourcePublicationId } : {}),
      ...(row.sourcePublicationDayId ? { sourcePublicationDayId: row.sourcePublicationDayId } : {}),
      ...(row.sourceVersion !== undefined ? { sourceVersion: row.sourceVersion } : {}),
      ...(row.sourceContentHash ? { sourceContentHash: row.sourceContentHash } : {}),
      ...(row.productionCategory ? { productionCategory: row.productionCategory } : {}),
      ...(row.requiresDelivery !== undefined ? { requiresDelivery: row.requiresDelivery } : {}),
      ...(row.clientName ? { clientName: row.clientName } : {}),
      ...(row.serviceType ? { serviceType: row.serviceType } : {}),
      serviceDate: row.serviceDate,
      guestCount: row.pax,
      ...(row.bookingDietaries ? { bookingDietaries: row.bookingDietaries } : {}),
      ...(row.bookingNotes ? { bookingNotes: row.bookingNotes } : {}),
      requiredBy: row.requiredBy,
      serviceWindow: row.serviceWindow,
      status: row.status,
      workflowStatus: row.workflowStatus,
      ...(cancellationNotice ? { cancellationNotice } : {}),
      priority: row.priority,
      lines,
      exceptions: row.attention.map((description, index) => ({
        canonicalId: `${row.id}:projection-exception:${index + 1}`,
        severity: "warning" as const,
        status: "open" as const,
        description,
        createdAt: projection.rebuiltAt,
        createdBy: "cpu-projection",
        audit: [],
      })),
      origin: (row.origin || "legacy_import") as ProductionOrder["origin"],
      currentRevision: row.version,
      createdAt: projection.rebuiltAt,
      createdBy: "cpu-projection",
      idempotencyKey: `projection:${row.id}`,
      externalReferences: [],
      audit: [],
    };
  });
}

export function filterCpuProjectionForScope(projection: CpuDayProjection, scope: ProductionScope): CpuDayProjection {
  if (scope === "all") return projection;
  const matchesOrigin = (row: CpuDayProjection["orders"][number]) => {
    if (scope === "hospitality") return row.origin === "hospitality_booking" || row.productionCategory === "hospitality" || row.productionCategory === "events";
    if (scope === "grab_and_go") return row.origin === "grab_and_go" || row.productionCategory === "grab_and_go";
    if (scope === "sandwiches") return false;
    return ["cpu_created", "menu_planning", "legacy_import"].includes(row.origin || "") || ["delivered_in", "fine_dining", "other"].includes(row.productionCategory || "");
  };
  const orders = projection.orders.flatMap((row) => {
    const workstreams = (row.productionScope || "").split(",").filter(Boolean);
    const aligned = workstreams.length === row.quantities.length;
    if (aligned) {
      const quantities = row.quantities.filter((_, index) => {
        const workstream = workstreams[index];
        return workstream && workstream !== "unassigned" ? workstream === scope : matchesOrigin(row);
      });
      if (!quantities.length) return [];
      const selected = quantities.map((quantity) => row.quantities.indexOf(quantity));
      return [{ ...row, quantities, productionScope: selected.map((index) => workstreams[index]).join(",") }];
    }

    // Older stored projections omitted unassigned entries from productionScope,
    // so their scope list cannot be paired safely with individual quantities.
    // Honor any explicit workstream at order level and use origin only when no
    // workstream was recorded at all.
    const explicit = workstreams.filter((workstream) => workstream !== "unassigned");
    if (explicit.length) return explicit.includes(scope) ? [{ ...row }] : [];
    return matchesOrigin(row) ? [{ ...row }] : [];
  });
  return { ...projection, orders, summary: { ...projection.summary, orders: orders.length, ready: orders.filter((order) => order.planningReadiness === "ready").length, attention: orders.filter((order) => order.attention.length > 0).length, planned: orders.filter((order) => order.workflowStatus === "planned").length, totalUnits: orders.reduce((sum, order) => sum + order.quantities.reduce((total, item) => total + item.quantity, 0), 0) } };
}

export function cpuProjectionMatchesOrders(projection: CpuDayProjection, orders: ProductionOrder[]) {
  const ids = new Set(orders.filter((order) => order.serviceDate === projection.serviceDate).map((order) => order.canonicalId));
  return projection.orders.length === ids.size && projection.orders.every((order) => ids.has(order.id));
}
