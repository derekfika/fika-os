import { createAllergenAuthorityStore, type AllergenAuthorityStore } from "./allergen-authority-store";
import { compositionIdentity, type AllergenCompositionAuthority, type CompositionOrder } from "./allergen-composition";

/**
 * The authority-generation binding a compiled projection / package records for every order whose Planned state rests on a
 * reused allergen approval. The binding is checked again on every read, so a cached projection can never keep serving
 * `planned` after its authority generation is revoked, re-approved, unverifiable, or after the booking's CURRENT canonical
 * composition stopped matching the composition the approval was adopted for. Event-driven rebuilds are only the fast path.
 */
export type ReusedAuthorityBinding = { compositionId: string; generation: number; originReleaseId: string; matrixSemanticHash: string };
/** Marks projections built with reuse bindings. A projection without it may contain reused entries that cannot be told apart. */
export const PROJECTION_AUTHORITY_BINDING_VERSION = 1;
export const REUSED_AUTHORITY_INVALID_ATTENTION = "The reused allergen approval is no longer valid; a fresh allergen review is required.";
export const UNVERIFIED_LEGACY_ATTENTION = "This cached plan predates reuse verification and is being re-verified; its allergen approval is not yet confirmed.";

type BoundOrder = { id: string; origin?: string; status?: string; workflowStatus?: string; planningReadiness?: string; allergenReadiness?: string; attention?: string[]; reusedAuthority?: ReusedAuthorityBinding; reusedAuthorityInvalid?: boolean; [key: string]: unknown };
type ProjectionLike = { orders: BoundOrder[]; authorityBindingVersion?: number; summary?: { planned?: number; ready?: number; attention?: number; [key: string]: unknown }; [key: string]: unknown };
export type ProjectionRevalidationContext = {
  store?: AllergenAuthorityStore;
  /** Loads the CURRENT canonical order. If it cannot be established the entry fails closed. */
  loadOrder: (orderId: string) => Promise<CompositionOrder | undefined>;
};

export function bindingStillValid(binding: ReusedAuthorityBinding, authority: AllergenCompositionAuthority | undefined) {
  return Boolean(authority && authority.compositionId === binding.compositionId && authority.status === "active" && !authority.revocation && authority.generation === binding.generation && authority.origin.releaseId === binding.originReleaseId && authority.matrixSemanticHash === binding.matrixSemanticHash);
}

/** Same readiness formula as `buildCpuDayProjection`, for an entry that is no longer Planned. */
const readyStatuses = ["ready", "in_production", "complete"];
function downgraded(order: BoundOrder, note: string): BoundOrder {
  const { reusedAuthority: _binding, ...rest } = order;
  const attention = [...(order.attention || []), note];
  return {
    ...rest,
    reusedAuthorityInvalid: true,
    workflowStatus: order.workflowStatus === "planned" ? "planning" : order.workflowStatus,
    planningReadiness: readyStatuses.includes(String(order.status)) ? "ready" : "attention",
    allergenReadiness: "attention",
    attention,
  };
}

/**
 * Response-only. An entry stays Planned only if it is provably valid:
 *  - bound entries: the authority generation is current and active with the same origin release and matrix hash, AND the
 *    booking's current canonical composition still equals the bound composition (else, or if it cannot be established, downgrade);
 *  - projections built before bindings existed (no version marker): every Hospitality Planned entry is unverifiable and is
 *    treated as non-authoritative.
 * Every readiness field and the summary are recomputed consistently. Costs one authority read per distinct composition and one
 * canonical order read per bound entry, and nothing when the projection has no such entries.
 */
export async function revalidateProjectionAuthority<T extends ProjectionLike>(projection: T, context: ProjectionRevalidationContext): Promise<T> {
  const store = context.store || createAllergenAuthorityStore();
  const legacy = projection.authorityBindingVersion !== PROJECTION_AUTHORITY_BINDING_VERSION;
  const needsCheck = (order: BoundOrder) => Boolean(order.reusedAuthority) || (legacy && order.origin === "hospitality_booking" && order.workflowStatus === "planned");
  if (!projection.orders.some(needsCheck)) return projection;
  const authorities = new Map<string, AllergenCompositionAuthority | undefined | Error>();
  for (const compositionId of new Set(projection.orders.map(order => order.reusedAuthority?.compositionId).filter((id): id is string => Boolean(id)))) {
    try { authorities.set(compositionId, await store.get(compositionId)); } catch (error) { authorities.set(compositionId, error instanceof Error ? error : new Error(String(error))); }
  }
  let changed = 0;
  const orders: BoundOrder[] = [];
  for (const order of projection.orders) {
    if (!needsCheck(order)) { orders.push(order); continue; }
    const binding = order.reusedAuthority;
    if (!binding) { changed += 1; orders.push(downgraded(order, UNVERIFIED_LEGACY_ATTENTION)); continue; }
    const authority = authorities.get(binding.compositionId);
    let compositionMatches = false;
    if (!(authority instanceof Error) && bindingStillValid(binding, authority)) {
      try { compositionMatches = compositionIdentity(await context.loadOrder(order.id))?.compositionId === binding.compositionId; } catch { compositionMatches = false; }
    }
    if (compositionMatches) orders.push(order);
    else { changed += 1; orders.push(downgraded(order, REUSED_AUTHORITY_INVALID_ATTENTION)); }
  }
  if (!changed) return projection;
  const summary = projection.summary ? { ...projection.summary, planned: orders.filter(order => order.workflowStatus === "planned").length, ready: orders.filter(order => order.planningReadiness === "ready").length, attention: orders.filter(order => (order.attention || []).length > 0).length } : projection.summary;
  return { ...projection, orders, ...(summary ? { summary } : {}) };
}
