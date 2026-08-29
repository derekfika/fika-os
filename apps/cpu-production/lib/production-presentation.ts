import type { ProductionOrder, ProductionStatus } from "./production-types";

export type CpuLifecycle = "received" | "accepted" | "planning" | "planned" | "ready" | "in_production" | "complete";

export const cpuLifecycleLabels: Record<CpuLifecycle, string> = {
  received: "Received",
  accepted: "Accepted",
  planning: "Planning",
  planned: "Planned",
  ready: "Ready",
  in_production: "In production",
  complete: "Complete",
};

const lifecycleOrder: CpuLifecycle[] = ["received", "accepted", "planning", "planned", "ready", "in_production", "complete"];

export function cpuLifecycle(order: ProductionOrder): CpuLifecycle {
  const status = (order.workflowStatus && order.workflowStatus !== "draft" ? order.workflowStatus : order.status) as ProductionStatus;
  if (status === "accepted") return "accepted";
  if (status === "planned") return "planned";
  if (status === "amended") return "planning";
  if (["planning", "menu_available"].includes(status)) return "planning";
  if (["ready", "scheduled"].includes(status)) return "ready";
  if (["in_production", "partially_complete"].includes(status)) return "in_production";
  if (status === "complete") return "complete";
  return "received";
}

export function cpuLifecycleIndex(order: ProductionOrder) { return lifecycleOrder.indexOf(cpuLifecycle(order)); }

export function cpuSourceLabel(order: ProductionOrder) {
  switch (order.origin) {
    case "hospitality_booking": return "Hospitality booking";
    case "grab_and_go": return "Grab & Go order";
    case "menu_planning": return "Published menu";
    case "cpu_created": return "CPU-created work";
    default: return "Imported production";
  }
}

export function cpuAttentionLabel(order: ProductionOrder) {
  if (order.cancellationNotice && !order.cpuDismissedAt) return "Cancelled booking";
  if (order.exceptions.some(exception => exception.status === "open" && exception.severity === "blocking")) return "Blocked";
  if (["blocked", "failed", "reconciliation_required"].includes(order.status)) return "Blocked";
  if (order.status === "needs_clarification") return "Needs clarification";
  if (order.status === "needs_review") return "Needs review";
  if (order.status === "amended" || order.version > 1) return "Amended";
  return "";
}

export function cpuAttentionKey(order: ProductionOrder) {
  const label = cpuAttentionLabel(order);
  if (label === "Cancelled booking") return "cancelled_booking";
  return label === "Needs review" ? "needs_review" : label === "Needs clarification" ? "needs_clarification" : label === "Blocked" ? "blocked" : label === "Amended" ? "amended" : "";
}

export function cpuRequiredTime(order: ProductionOrder) {
  const value = order.requiredBy || "";
  if (!value.includes("T")) return "Time TBC";
  const time = value.slice(11, 16);
  return time === "00:00" ? "Time TBC" : time;
}

export function cpuReference(order: ProductionOrder) {
  return order.sourceEntityId || order.sourceBookingId || order.canonicalId;
}

export function cpuDestinationLabel(order: ProductionOrder) {
  return order.destinationLabel || order.destinationOplocId || "Destination not assigned";
}

export function cpuDestinationOptionLabel(order: ProductionOrder) {
  return cpuDestinationLabel(order);
}

export function titleCaseDish(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB").replace(/\b\w/g, character => character.toLocaleUpperCase("en-GB"));
}

export function hasCpuAttention(order: ProductionOrder) { return Boolean(cpuAttentionLabel(order)); }
