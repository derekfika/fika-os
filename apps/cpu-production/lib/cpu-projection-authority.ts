import { createAllergenAuthorityStore, type AllergenAuthorityStore } from "./allergen-authority-store";
import type { AllergenCompositionAuthority } from "./allergen-composition";

/**
 * The authority-generation binding a compiled projection / package records for every order whose Planned state rests on a
 * reused allergen approval. The binding is checked again on every read, so a cached projection can never keep serving
 * `planned` after its authority generation is revoked, re-approved or unverifiable. Event-driven rebuilds are only the fast path.
 */
export type ReusedAuthorityBinding = { compositionId: string; generation: number; originReleaseId: string; matrixSemanticHash: string };
export const REUSED_AUTHORITY_INVALID_ATTENTION = "The reused allergen approval is no longer valid; a fresh allergen review is required.";

type BoundOrder = { id: string; workflowStatus?: string; planningReadiness?: string; allergenReadiness?: string; attention?: string[]; reusedAuthority?: ReusedAuthorityBinding; reusedAuthorityInvalid?: boolean; [key: string]: unknown };
type ProjectionLike = { orders: BoundOrder[]; summary?: { planned?: number; ready?: number; attention?: number; [key: string]: unknown }; [key: string]: unknown };

export function bindingStillValid(binding: ReusedAuthorityBinding, authority: AllergenCompositionAuthority | undefined) {
  return Boolean(authority && authority.compositionId === binding.compositionId && authority.status === "active" && !authority.revocation && authority.generation === binding.generation && authority.origin.releaseId === binding.originReleaseId && authority.matrixSemanticHash === binding.matrixSemanticHash);
}

/**
 * Response-only: downgrades every bound order whose authority generation no longer validates (or cannot be read: fail closed).
 * Costs one authority document read per distinct composition, and nothing when the projection contains no reused entries.
 */
export async function revalidateProjectionAuthority<T extends ProjectionLike>(projection: T, store: AllergenAuthorityStore = createAllergenAuthorityStore()): Promise<T> {
  const bound = projection.orders.filter(order => order.reusedAuthority);
  if (!bound.length) return projection;
  const authorities = new Map<string, AllergenCompositionAuthority | undefined | Error>();
  for (const compositionId of new Set(bound.map(order => order.reusedAuthority!.compositionId))) {
    try { authorities.set(compositionId, await store.get(compositionId)); } catch (error) { authorities.set(compositionId, error instanceof Error ? error : new Error(String(error))); }
  }
  let downgraded = 0;
  const orders = projection.orders.map(order => {
    const binding = order.reusedAuthority;
    if (!binding) return order;
    const authority = authorities.get(binding.compositionId);
    if (!(authority instanceof Error) && bindingStillValid(binding, authority)) return order;
    downgraded += 1;
    const { reusedAuthority: _binding, ...rest } = order;
    return { ...rest, reusedAuthorityInvalid: true, workflowStatus: order.workflowStatus === "planned" ? "planning" : order.workflowStatus, planningReadiness: "attention", attention: [...(order.attention || []), REUSED_AUTHORITY_INVALID_ATTENTION] } as BoundOrder;
  });
  if (!downgraded) return projection;
  const summary = projection.summary ? { ...projection.summary, planned: orders.filter(order => order.workflowStatus === "planned").length, ready: orders.filter(order => order.planningReadiness === "ready").length, attention: orders.filter(order => (order.attention || []).length > 0).length } : projection.summary;
  return { ...projection, orders, ...(summary ? { summary } : {}) };
}
