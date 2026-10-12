import { applyReusedAuthority, buildAuthorityFromSignedPlan, clearReuse, hasOwnSignedAuthority, compositionIdentity, evaluateReuse, reuseStillValid, type AllergenCompositionAuthority, type CompositionOrder, type ReuseRefusal } from "./allergen-composition";
import type { AllergenAuthorityStore } from "./allergen-authority-store";
import type { ProductionPlan } from "../app/lib/production-plan";

type Order = CompositionOrder & { sourceBookingId?: string; sourceQuoteRevisionId?: string };

export type ReuseCandidateView =
  | { available: true; compositionId: string; origin: AllergenCompositionAuthority["origin"]; matrixSemanticHash: string }
  | { available: false; reason: ReuseRefusal };

/** Called after a plan is signed. Records the composition authority; first approval wins and a retry is a no-op. */
export async function recordSignedAuthority(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined, at: string, by: string) {
  if (!order || plan.reusedAllergenAuthority) return undefined;
  const candidate = buildAuthorityFromSignedPlan(plan, order, at, by);
  return candidate ? store.recordApproval(candidate, at, by) : undefined;
}

/** What CPU may offer for this order right now. Response-only; never mutates. */
export async function reuseCandidateFor(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined): Promise<ReuseCandidateView> {
  const identity = compositionIdentity(order);
  if (!identity) return { available: false, reason: "composition_unavailable" };
  const authority = await store.get(identity.compositionId);
  const decision = evaluateReuse(order, plan, authority);
  return decision.ok && authority ? { available: true, compositionId: authority.compositionId, origin: authority.origin, matrixSemanticHash: authority.matrixSemanticHash } : { available: false, reason: decision.ok ? "authority_missing" : decision.reason };
}

/** Explicit CPU command. Repeating it on an already-adopted plan changes nothing. */
export async function adoptReusableAuthority(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order, input: { by: string; at: string }): Promise<{ plan: ProductionPlan; changed: boolean }> {
  const identity = compositionIdentity(order);
  if (!identity) throw Object.assign(new Error("This booking has no canonical sandwich composition, so a previous approval cannot be reused. Review it normally."), { status: 409, code: "CPU_ALLERGEN_REUSE_COMPOSITION_UNAVAILABLE" });
  const authority = await store.get(identity.compositionId);
  if (plan.reusedAllergenAuthority && authority && reuseStillValid(plan, order) && plan.reusedAllergenAuthority.compositionId === authority.compositionId && authority.status === "active") return { plan, changed: false };
  const next = applyReusedAuthority(plan, order, authority as AllergenCompositionAuthority, input);
  await store.registerReuse(identity.compositionId, plan.orderId, input.at, input.by);
  return { plan: next, changed: true };
}

/**
 * Drops reuse provenance that no longer describes the plan: composition changed (amendment), states edited by hand, the booking
 * was signed on its own authority, or the shared authority was revoked. Mutates `plan`; returns whether anything changed.
 */
export async function reconcileReuse(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined, input: { by: string; at: string }) {
  const reuse = plan.reusedAllergenAuthority;
  if (!reuse) return false;
  if (hasOwnSignedAuthority(plan)) return clearReuse(plan, { ...input, reason: "This booking now carries its own signed allergen authority; reuse provenance was superseded." });
  if (!reuseStillValid(plan, order)) return clearReuse(plan, { ...input, reason: "The booking composition or the reviewed states changed after a previous approval was reused; a fresh allergen review is required." });
  const authority = await store.get(reuse.compositionId);
  if (!authority || authority.status !== "active") return clearReuse(plan, { ...input, reason: "The previously approved allergen authority was revoked; a fresh allergen review is required." });
  return false;
}

/** After an origin release is revoked: revoke the shared authority and reopen every booking that adopted it. */
export async function revokeAuthorityForRelease(store: AllergenAuthorityStore, order: Order | undefined, releaseId: string, input: { by: string; at: string; reason: string }) {
  const identity = compositionIdentity(order);
  if (!identity) return [] as string[];
  const revoked = await store.revokeForOrigin(identity.compositionId, releaseId, input.at, input.by, input.reason);
  return revoked ? revoked.reusedBy.map(item => item.orderId).filter(orderId => orderId !== revoked.origin.orderId) : [];
}

/** Reopens one adopting plan after its authority was revoked. Mutates; returns whether the plan changed. */
export function reopenAdoptingPlan(plan: ProductionPlan, input: { by: string; at: string }) {
  return clearReuse(plan, { ...input, reason: "The previously approved allergen authority was revoked; a fresh allergen review is required." });
}

export type ReuseView = { candidate?: ReuseCandidateView; applied?: { valid: boolean; invalidReason?: string; provenance: NonNullable<ProductionPlan["reusedAllergenAuthority"]> } };

/** Response-only view for the CPU UI: a candidate to offer, or the provenance of an adopted authority and whether it still holds. */
export async function reuseViewFor(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined): Promise<ReuseView | undefined> {
  const reuse = plan.reusedAllergenAuthority;
  if (reuse) {
    if (!reuseStillValid(plan, order)) return { applied: { valid: false, invalidReason: "The booking composition or reviewed states changed after the approval was reused.", provenance: reuse } };
    const authority = await store.get(reuse.compositionId);
    if (!authority || authority.status !== "active") return { applied: { valid: false, invalidReason: "The previously approved authority was revoked.", provenance: reuse } };
    return { applied: { valid: true, provenance: reuse } };
  }
  if (hasOwnSignedAuthority(plan)) return undefined;
  const candidate = await reuseCandidateFor(store, plan, order);
  return candidate.available ? { candidate } : undefined;
}
