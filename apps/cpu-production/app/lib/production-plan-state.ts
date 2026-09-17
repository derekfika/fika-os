import { isCompleteOperationalAllergenMap } from "../../../shared/allergen-contract";
import type { PlanStatus, PlannedMenuItem, ProductionPlan } from "./production-plan";

/** The current canonical matrix is complete only when every row is named, checked and fully recorded. */
export function isProductionPlanMatrixComplete(menuItems: PlannedMenuItem[]) {
  return menuItems.length > 0 && menuItems.every((item) => item.name.trim() && item.subItems.length > 0 && item.subItems.every((subItem) => subItem.name.trim() && subItem.evidenceStatus === "completed" && isCompleteOperationalAllergenMap(subItem.allergens)));
}

/** Existing signatures/releases remain a separate lock from the unsigned planned-state repair. */
export function hasAllergenAuthority(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "matrixArtifact" | "signedMatrixArtifact" | "masterMatrixArtifact" | "siteMatrixArtifacts">) {
  return Boolean(plan.currentAllergenRelease || plan.signatures?.length || plan.signedSignatures?.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
}

/** A stale planned value cannot lock an incomplete current matrix. */
export function effectiveProductionPlanStatus(plan: Pick<ProductionPlan, "status" | "menuItems">): PlanStatus {
  return plan.status === "planned" && !isProductionPlanMatrixComplete(plan.menuItems) ? "planning" : plan.status;
}

export function mergeMissingProductionOrderLines(plan: ProductionPlan, orderId: string, lines: Array<{ canonicalId: string; itemName: string; customerQuantity: number }>) {
  const existing = new Set(plan.menuItems.map((item) => item.sourceLineId || item.id));
  const missing = lines.filter((line) => !existing.has(line.canonicalId)).map((line, index) => ({ id: `menu-item:${orderId}:original:${index}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:original:${index}`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" as const }] }));
  const next = missing.length ? { ...plan, menuItems: [...plan.menuItems, ...missing] } : plan;
  return { ...next, status: effectiveProductionPlanStatus(next) };
}
