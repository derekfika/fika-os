import { buildAuthorityFromSignedPlan, clearReuse, compositionIdentity, evaluateReuse, hasOwnSignedAuthority, reuseValidity, type AllergenCompositionAuthority, type CompositionOrder, type ReuseRefusal, type ReuseValidity } from "./allergen-composition";
import { releaseMatrix } from "./cpu-allergen-release";
import type { AllergenAuthorityStore } from "./allergen-authority-store";
import type { ProductionPlan } from "../app/lib/production-plan";

type Order = CompositionOrder & { sourceBookingId?: string; sourceQuoteRevisionId?: string };

export type ReuseCandidateView =
  | { available: true; compositionId: string; generation: number; origin: AllergenCompositionAuthority["origin"]; matrixSemanticHash: string }
  | { available: false; reason: ReuseRefusal | "authority_lookup_failed" };

/** Called after a plan is signed. Builds the authority from the stamped, signed release; the caller persists it (see orchestrator). */
export function signedAuthorityCandidate(plan: ProductionPlan, order: Order | undefined, at: string, by: string) {
  if (!order || plan.reusedAllergenAuthority || plan.currentAllergenRelease?.approvalMode === "reused_authority") return undefined;
  return buildAuthorityFromSignedPlan(plan, order, at, by);
}

/** What CPU may offer for this order right now. Response-only; never mutates. A lookup failure offers nothing (fail closed). */
export async function reuseCandidateFor(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined): Promise<ReuseCandidateView> {
  const identity = compositionIdentity(order);
  if (!identity) return { available: false, reason: "composition_unavailable" };
  let authority: AllergenCompositionAuthority | undefined;
  try { authority = await store.get(identity.compositionId); } catch { return { available: false, reason: "authority_lookup_failed" }; }
  const decision = evaluateReuse(order, plan, authority);
  return decision.ok && authority ? { available: true, compositionId: authority.compositionId, generation: authority.generation, origin: authority.origin, matrixSemanticHash: authority.matrixSemanticHash } : { available: false, reason: decision.ok ? "authority_missing" : decision.reason };
}

/**
 * THE single authoritative validity check for a reused approval. Every path that can expose, materialize, project, download or
 * act on a reused release goes through this. It FAILS CLOSED: a lookup error is "invalid", never "valid".
 */
export async function validateReusedApproval(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined, cache?: Map<string, AllergenCompositionAuthority | undefined | Error>): Promise<ReuseValidity> {
  const release = plan.currentAllergenRelease;
  const reusedRelease = release?.approvalMode === "reused_authority";
  if (!plan.reusedAllergenAuthority) return reusedRelease ? { valid: false, reason: "release_without_provenance" } : { valid: false, reason: "no_reuse_provenance" };
  const reuse = plan.reusedAllergenAuthority;
  let authority: AllergenCompositionAuthority | undefined;
  try {
    const cached = cache?.get(reuse.compositionId);
    if (cached instanceof Error) return { valid: false, reason: "authority_lookup_failed" };
    if (cache?.has(reuse.compositionId)) authority = cached as AllergenCompositionAuthority | undefined;
    else { authority = await store.get(reuse.compositionId); cache?.set(reuse.compositionId, authority); }
  } catch (error) {
    cache?.set(reuse.compositionId, error instanceof Error ? error : new Error(String(error)));
    return { valid: false, reason: "authority_lookup_failed" };
  }
  const base = reuseValidity(plan, order, authority);
  if (!base.valid) return base;
  if (release) {
    if (!reusedRelease) return { valid: false, reason: "release_not_reused" };
    const bound = release.reusedAuthority;
    if (!bound || bound.generation !== reuse.generation || bound.compositionId !== reuse.compositionId || bound.matrixSemanticHash !== reuse.matrixSemanticHash || bound.origin.releaseId !== reuse.origin.releaseId) return { valid: false, reason: "release_binding_mismatch" };
    if (release.status === "revoked" || JSON.stringify(release.matrix) !== JSON.stringify(releaseMatrix(plan.menuItems))) return { valid: false, reason: "release_matrix_mismatch" };
  }
  return { valid: true };
}

/** Returns the plan with every reused-authority artifact removed and the status downgraded. Pure. */
export function withoutReusedAuthority<T extends ProductionPlan>(plan: T): T {
  // The approved states stay visible as a starting point but are marked for review, so no reader can treat the matrix as reviewed/complete.
  const menuItems = plan.menuItems.map(item => ({ ...item, subItems: item.subItems.map(sub => ({ ...sub, evidenceStatus: "requires_review" as const })) }));
  return { ...plan, menuItems, status: plan.status === "planned" ? "planning" : plan.status, currentAllergenRelease: undefined, matrixArtifact: undefined, signedMatrixArtifact: undefined, masterMatrixArtifact: undefined, siteMatrixArtifacts: undefined };
}

/**
 * Fail closed on any read: a plan that carries reuse provenance or a reused release is returned unreviewed, with no release or
 * artifacts, unless the shared authority contract validates right now. Response-only.
 */
export async function guardReusedPlan<T extends ProductionPlan>(store: AllergenAuthorityStore, plan: T, order: Order | undefined, cache?: Map<string, AllergenCompositionAuthority | undefined | Error>): Promise<T> {
  if (!plan.reusedAllergenAuthority && plan.currentAllergenRelease?.approvalMode !== "reused_authority") return plan;
  const validity = await validateReusedApproval(store, plan, order, cache);
  return validity.valid ? plan : withoutReusedAuthority(plan);
}

export type ReuseView = { candidate?: ReuseCandidateView; applied?: { valid: boolean; invalidReason?: string; provenance: NonNullable<ProductionPlan["reusedAllergenAuthority"]> } };
const REASONS: Record<string, string> = {
  authority_revoked: "The previously approved authority was revoked.",
  authority_lookup_failed: "The previously approved authority could not be verified.",
  generation_mismatch: "The previously approved authority has since been re-approved; this booking needs a fresh review.",
  composition_or_matrix_changed: "The booking composition or reviewed states changed after the approval was reused.",
};

/** Response-only view for the CPU UI: a candidate to offer, or the provenance of an adopted authority and whether it still holds. */
export async function reuseViewFor(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined): Promise<ReuseView | undefined> {
  const reuse = plan.reusedAllergenAuthority;
  if (reuse) {
    const validity = await validateReusedApproval(store, plan, order);
    return validity.valid ? { applied: { valid: true, provenance: reuse } } : { applied: { valid: false, invalidReason: REASONS[validity.reason] || "The previously approved authority no longer applies.", provenance: reuse } };
  }
  if (hasOwnSignedAuthority(plan)) return undefined;
  const candidate = await reuseCandidateFor(store, plan, order);
  return candidate.available ? { candidate } : undefined;
}

/**
 * Drops reuse provenance that no longer describes the plan before a mutation persists it: composition changed (amendment),
 * states edited by hand, the booking was signed on its own authority, or the shared authority no longer validates. A store
 * outage aborts the mutation rather than silently keeping or dropping the approval.
 */
export async function reconcileReuse(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined, input: { by: string; at: string }) {
  if (!plan.reusedAllergenAuthority) return false;
  if (hasOwnSignedAuthority(plan)) return clearReuse(plan, { ...input, reason: "This booking now carries its own signed allergen authority; reuse provenance was superseded." });
  const authority = await store.get(plan.reusedAllergenAuthority.compositionId);
  const validity = reuseValidity(plan, order, authority);
  // When the authority itself is gone the copied states must be reviewed again; a manual edit or composition change is already a chef review.
  const authorityGone = !validity.valid && !["composition_or_matrix_changed", "no_reuse_provenance"].includes(validity.reason);
  return validity.valid ? false : clearReuse(plan, { ...input, reason: `The reused allergen approval no longer applies (${validity.reason}); a fresh allergen review is required.`, reviewAgain: authorityGone });
}

/** Throws 409 unless the reused approval validates right now. Used before any materialization step acts on a reused release. */
export async function assertReusedApprovalValid(store: AllergenAuthorityStore, plan: ProductionPlan, order: Order | undefined) {
  const validity = await validateReusedApproval(store, plan, order);
  if (!validity.valid) throw Object.assign(new Error(`The reused allergen approval is no longer valid (${validity.reason}); the release cannot be materialized.`), { status: 409, code: "CPU_REUSED_AUTHORITY_INVALID" });
}
