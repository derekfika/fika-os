import type { ProductionOrder, ProductionLine } from "@hub/lib/production-domain";
import type { CpuDayProjection } from "./cpu-projection";
import type { ProductionScope } from "./production-scope";

export function weekCommencingFor(serviceDate: string) { const date = new Date(`${serviceDate}T00:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }

/** Rehydrates the compact day read model into the shape used by the existing UI. */
export function cpuProjectionToOrders(projection: CpuDayProjection): ProductionOrder[] {
  return projection.orders.map((row) => {
    const lines: ProductionLine[] = row.quantities.map((quantity, index) => ({
      canonicalId: `${row.id}:projection-line:${index + 1}`,
      sourceBookingLineId: `${row.id}:projection-line:${index + 1}`,
      itemName: quantity.name,
      customerQuantity: quantity.quantity,
      customerUnit: quantity.unit,
      productionQuantity: quantity.quantity,
      productionUnit: quantity.unit,
      dietaries: {},
      status: "ready",
      sortOrder: index,
      workstream: row.productionScope?.split(",")[index] as ProductionLine["workstream"],
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
      ...(row.clientName ? { clientName: row.clientName } : {}),
      ...(row.serviceType ? { serviceType: row.serviceType } : {}),
      serviceDate: row.serviceDate,
      guestCount: row.pax,
      requiredBy: row.requiredBy,
      serviceWindow: row.serviceWindow,
      status: row.status,
      workflowStatus: row.workflowStatus,
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
  const orders = projection.orders.filter((row) => {
    const workstreams = row.productionScope || "";
    if (scope === "sandwiches") return workstreams.includes("sandwiches");
    if (scope === "hospitality") return row.origin === "hospitality_booking" || workstreams.includes("hospitality");
    if (scope === "grab_and_go") return row.origin === "grab_and_go";
    return ["cpu_created", "menu_planning", "legacy_import"].includes(row.origin || "") || workstreams.includes("delivered_in");
  });
  return { ...projection, orders, summary: { ...projection.summary, orders: orders.length, ready: orders.filter((order) => order.planningReadiness === "ready").length, attention: orders.filter((order) => order.attention.length > 0).length, planned: orders.filter((order) => order.workflowStatus === "planned").length, totalUnits: orders.reduce((sum, order) => sum + order.quantities.reduce((total, item) => total + item.quantity, 0), 0) } };
}

export function cpuProjectionMatchesOrders(projection: CpuDayProjection, orders: ProductionOrder[]) {
  const ids = new Set(orders.filter((order) => order.serviceDate === projection.serviceDate).map((order) => order.canonicalId));
  return projection.orders.length === ids.size && projection.orders.every((order) => ids.has(order.id));
}
