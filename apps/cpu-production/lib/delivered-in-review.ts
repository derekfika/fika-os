import type { ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "./production-types";
import type { ProductionPlanRepository } from "./production-plan-repository";
import { recordDeliveredInReadBudget } from "./delivered-in-read-budget";

export const MAX_DELIVERED_IN_REVIEW_ORDER_IDS = 100;

export type DeliveredInReviewStatus = {
  orderId: string;
  planStatus: ProductionPlan["status"];
  reviewed: boolean;
  completedSourceLineIds: string[];
  signatureRoles: Array<"production_chef" | "head_chef_site_manager">;
  matrixStatus?: "ready" | "generating";
  matrixArtifact?: { driveUrl?: string; localUrl?: string };
  updatedAt?: string;
  matrixItems?: Array<{ sourceLineId: string; allergens: Record<string, string>; mayContainNotes?: string; evidenceStatus: string }>;
};

export function parseDeliveredInReviewOrderIds(value: string | null) {
  if (value === null) throw Object.assign(new Error("Delivered-In review order IDs are required."), { status: 400 });
  const ids = [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) throw Object.assign(new Error("Delivered-In review order IDs are required."), { status: 400 });
  if (ids.length > MAX_DELIVERED_IN_REVIEW_ORDER_IDS) throw Object.assign(new Error(`A maximum of ${MAX_DELIVERED_IN_REVIEW_ORDER_IDS} Delivered-In review orders may be requested.`), { status: 400 });
  return ids;
}

export function reviewStatusForPlan(orderId: string, plan: ProductionPlan | undefined): DeliveredInReviewStatus {
  if (!plan) return { orderId, planStatus: "draft", reviewed: false, completedSourceLineIds: [], signatureRoles: [], matrixItems: [] };
  const completedSourceLineIds = plan.menuItems
    .filter((item) => item.sourceLineId && item.subItems.length > 0 && item.subItems.every(subItem => subItem.evidenceStatus === "completed"))
    .map((item) => item.sourceLineId!);
  const signatureRoles = [...new Set((plan.signatures || []).map((signature) => signature.role))];
  return {
    orderId,
    planStatus: plan.status,
    reviewed: plan.menuItems.length > 0 && plan.menuItems.every((item) => item.sourceLineId && item.subItems.length > 0 && item.subItems.every(subItem => subItem.evidenceStatus === "completed")),
    completedSourceLineIds,
    signatureRoles,
    updatedAt: plan.updatedAt,
    matrixItems: plan.menuItems.flatMap((item) => item.sourceLineId ? item.subItems.map(subItem => ({ sourceLineId: item.sourceLineId!, sourceSubItemId: subItem.id, allergens: subItem.allergens, mayContainNotes: subItem.mayContainNotes, evidenceStatus: subItem.evidenceStatus })) : []),
    ...(plan.matrixArtifact ? { matrixStatus: "ready" as const } : signatureRoles.includes("production_chef") && signatureRoles.includes("head_chef_site_manager") ? { matrixStatus: "generating" as const } : {}),
    ...(plan.matrixArtifact ? { matrixArtifact: { driveUrl: plan.matrixArtifact.driveUrl, localUrl: plan.matrixArtifact.localUrl } } : {}),
  };
}

export async function loadDeliveredInReviewStatuses(input: {
  orderIds: string[];
  repository: Pick<ProductionPlanRepository, "get">;
  loadOrder: (orderId: string) => Promise<ProductionOrder | undefined>;
  includeMatrix?: boolean;
}) {
  const visibleOrders: ProductionOrder[] = [];
  for (const orderId of [...new Set(input.orderIds)]) {
    const order = await input.loadOrder(orderId);
    if (order && !(order.origin === "hospitality_booking" && order.requiresDelivery === false)) visibleOrders.push(order);
  }
  const plans = await Promise.all(visibleOrders.map(async (order) => [order.canonicalId, await input.repository.get(order.canonicalId)] as const));
  const planByOrderId = new Map(plans);
  recordDeliveredInReadBudget({ stage: "review_status_batch", canonicalOrderDocs: visibleOrders.length, planDocs: plans.length, selectedIds: input.orderIds.length });
  return visibleOrders.map((order) => {
    const status = reviewStatusForPlan(order.canonicalId, planByOrderId.get(order.canonicalId));
    return input.includeMatrix ? status : Object.fromEntries(Object.entries(status).filter(([key]) => key !== "matrixItems"));
  });
}
