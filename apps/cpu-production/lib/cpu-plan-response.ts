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

/**
 * `POST apply-reused-authority` response, for EVERY path (new adoption, idempotent replay, after post-commit delivery). The plan
 * is reloaded by the caller after any asynchronous work and then passes through the same `guardReusedPlan` as the GET paths. If
 * the authority is no longer valid (revoked during delivery, re-approved, unverifiable, or the adoption is gone) the response is
 * a 409 carrying the downgraded plan: it never exposes the reused release as authoritative and never reports success by reuse.
 */
export async function applyReuseResponse(store: AllergenAuthorityStore, input: { plan: ProductionPlan; order: ProductionOrder | undefined; unchanged?: boolean; materializationDelivery?: unknown }): Promise<{ status: number; body: Record<string, unknown> }> {
  const safe = await guardReusedPlan(store, input.plan, input.order as never);
  const applied = safe === input.plan && Boolean(safe.reusedAllergenAuthority);
  if (!applied) {
    return { status: 409, body: { error: { code: "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED", message: "The approved allergen authority is no longer valid for this booking. A fresh allergen review is required." }, plan: safe, plans: [safe], reuse: { applied: false }, approvedMatrixAvailable: false, notifications: [], menus: [] } };
  }
  return { status: 200, body: { plan: safe, reuse: { applied: true, ...(input.unchanged ? { unchanged: true } : {}) }, approvedMatrixAvailable: Boolean(input.order && reusedAuthorityReleaseMatchesOrder(safe.currentAllergenRelease, input.order, safe.menuItems)), ...(input.materializationDelivery ? { materializationDelivery: input.materializationDelivery } : {}) } };
}

/**
 * Final `apply-reused-authority` response. It never validates against a snapshot captured before the command waited on
 * delivery/materialization: it reloads the CURRENT CPU plan and the LATEST canonical order from the canonical provider and only
 * then builds the guarded response. If the canonical order cannot be loaded, or its composition no longer matches the adopted
 * one, the response fails closed exactly like a revoked authority.
 */
export async function finalApplyResponse(store: AllergenAuthorityStore, input: { orderId: string; fallbackPlan: ProductionPlan; loadPlan: (orderId: string) => Promise<ProductionPlan | undefined>; loadOrder: (orderId: string) => Promise<ProductionOrder | undefined>; unchanged?: boolean; materializationDelivery?: unknown }) {
  const plan = (await input.loadPlan(input.orderId)) ?? input.fallbackPlan;
  let order: ProductionOrder | undefined;
  try { order = await input.loadOrder(input.orderId); } catch { order = undefined; }
  return applyReuseResponse(store, { plan, order, unchanged: input.unchanged, materializationDelivery: input.materializationDelivery });
}
