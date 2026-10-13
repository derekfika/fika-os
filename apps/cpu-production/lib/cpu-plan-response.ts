import type { ProductionPlan } from "../app/lib/production-plan";
import { reusedAuthorityReleaseMatchesOrder, signedAllergenReviewMatchesOrder } from "../app/lib/production-plan";
import type { AllergenAuthorityStore } from "./allergen-authority-store";
import { guardReusedPlan, type ReuseView } from "./allergen-reuse-service";
import type { ProductionOrder } from "./production-types";

/**
 * Response construction for plan reads. EVERY field that can carry plan state (plan, plans[], notifications, menus, matrix flags)
 * is derived from the one guarded plan produced here, never from the raw stored plan. A stale, revoked or unverifiable reused
 * approval therefore downgrades all of them together, and an authority-store failure fails closed consistently.
 */
const notificationFor = (plan: ProductionPlan) => ({ id: `notification:${plan.id}`, title: "New production plan ready for menu generation.", orderId: plan.orderId, plannedItemCount: plan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: plan.updatedAt });
const menuFor = (plan: ProductionPlan, order: Pick<ProductionOrder, "destinationLabel"> | undefined) => ({ planId: plan.id, orderId: plan.orderId, clientSite: order?.destinationLabel || "Site not assigned", items: plan.menuItems.flatMap(item => item.subItems.map(subItem => ({ menuItem: item.name, name: subItem.name, quantity: subItem.quantity, allergens: Object.entries(subItem.allergens).filter(([, state]) => state === "contains").map(([key]) => key), mayContain: Object.entries(subItem.allergens).filter(([, state]) => state === "may_contain").map(([key]) => key) }))) });

/** `GET ?orderId=` body. */
export async function selectedPlanResponseBody(store: AllergenAuthorityStore, input: { plan: ProductionPlan | undefined; order: ProductionOrder | undefined; reuse?: ReuseView; matrixStatus?: string; signingLineage?: unknown }) {
  const safe = input.plan && input.order ? await guardReusedPlan(store, input.plan, input.order as never) : input.plan;
  const stale = safe !== input.plan;
  const signedMatrixAvailable = Boolean(safe && input.order && signedAllergenReviewMatchesOrder(safe, input.order, safe.menuItems));
  const approvedMatrixAvailable = Boolean(safe && input.order && !stale && reusedAuthorityReleaseMatchesOrder(safe.currentAllergenRelease, input.order, safe.menuItems));
  return {
    plan: safe,
    ...(input.reuse ? { reuse: input.reuse } : {}),
    approvedMatrixAvailable,
    signingLineage: input.signingLineage || null,
    matrixStatus: stale ? undefined : input.matrixStatus,
    ...(safe?.currentAllergenRelease?.materializationError ? { matrixError: safe.currentAllergenRelease.materializationError } : {}),
    signedMatrixAvailable,
    plans: safe ? [safe] : [],
    notifications: safe?.status === "planned" ? [notificationFor(safe)] : [],
    menus: [] as unknown[],
  };
}

/** `GET ?serviceDate=` body: `visiblePlans` must already be the guarded set. */
export function servicePlansResponseBody(visiblePlans: ProductionPlan[], orders: Array<Pick<ProductionOrder, "canonicalId" | "destinationLabel">>) {
  const entries = visiblePlans.filter(plan => plan.status === "planned");
  return { plans: visiblePlans, notifications: entries.map(notificationFor), menus: entries.map(plan => menuFor(plan, orders.find(order => order.canonicalId === plan.orderId))) };
}
