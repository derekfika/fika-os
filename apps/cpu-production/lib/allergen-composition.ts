import { canonicalJson, sha256 } from "@fika/server-shared/read-package";
import { isCompleteOperationalAllergenMap, normaliseOperationalAllergens } from "../../shared/allergen-contract";
import { isProductionPlanMatrixComplete } from "../app/lib/production-plan-state";
import type { PlannedMenuItem, PlannedSubItem, ProductionPlan } from "../app/lib/production-plan";

/**
 * Shared canonical allergen approval for Hospitality sandwich lunches.
 *
 * A COMPOSITION IDENTITY is derived only from the allergen-relevant canonical composition of a Hospitality order: the stable
 * catalogue item IDs, any selected choices, and (when the line carries them) the allergen states and evidence. It never uses
 * quantities, guest counts, dietary headcounts, booking/customer/date identity, display names or line ordering.
 *
 * An approved matrix that a CPU chef and head chef signed for one booking is recorded as an AUTHORITY keyed by that identity.
 * Another booking with the same identity may REUSE it: the approved states are applied to that booking's own plan with explicit
 * provenance. Reuse never signs, never copies signatures, and never touches the origin plan, release or signatures.
 */

export const COMPOSITION_IDENTITY_VERSION = "fika.allergen-composition.v2";
export const AUTHORITY_SCHEMA = "fika.cpu-allergen-composition-authority.v2";
/** Only these workstreams are eligible: reuse is scoped to Hospitality sandwich lunches. */
export const REUSABLE_WORKSTREAMS = ["sandwiches"] as const;

export type CompositionLine = {
  canonicalId: string;
  sourceMenuItemId?: string;
  sourceOfferingId?: string;
  choices?: unknown[];
  workstream?: string;
  /** Production-affecting fields: any of these can change what is physically made, so they participate in identity. */
  substitution?: string;
  productionInstructions?: string;
  servingGuidance?: string;
  description?: string;
  allergenEvidenceStatus?: string;
  status?: string;
  exceptions?: string[];
  approvedAllergenSnapshot?: { allergens: Record<string, string>; allergenEvidenceStatus?: string; mayContainNotes?: string };
};
export type CompositionOrder = { canonicalId: string; origin?: string; requiresDelivery?: boolean; lines: CompositionLine[] };

export type CompositionEntry = {
  itemId: string;
  offeringId: string | null;
  choices: string[];
  /** Normalised production-affecting free text (substitution, instructions, serving guidance, description). Empty when none. */
  production: { substitution: string; instructions: string; servingGuidance: string; description: string };
  /** Line-level allergen evidence status; conflicting lines are never eligible. */
  evidenceStatus: string | null;
  /** Allergen inputs carried on the composition itself. `null` means none are recorded there (never "clear"). */
  allergenInputs: null | { states: Record<string, string>; evidence: string | null; mayContainNotes: string };
};
export type CompositionIdentity = { compositionId: string; identityVersion: string; entries: CompositionEntry[] };

/** Signed authority belonging to the plan itself. A release that exists only because of a reused authority does not count. */
export function hasOwnSignedAuthority(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "signedMatrixArtifact">) {
  const release = plan.currentAllergenRelease;
  return Boolean(plan.signatures?.length || plan.signedSignatures?.length || plan.signedMenuContentHash || plan.signedMatrixArtifact || (release && release.approvalMode !== "reused_authority"));
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Order-independent normalisation of a selected-choice value. */
function normaliseChoiceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(normaliseChoiceValue);
    return items.every(item => typeof item === "string" || typeof item === "number" || typeof item === "boolean") ? [...items].sort((a, b) => String(a).localeCompare(String(b))) : items.map(item => canonicalJson(item)).sort();
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normaliseChoiceValue(item)]));
  return typeof value === "string" ? value.trim() : value;
}

/**
 * Only Hospitality sandwich-lunch orders whose every line carries a stable catalogue item ID have a composition identity.
 * A line with conflicting allergen evidence or an open production exception is never eligible: fail closed, fresh review.
 */
export function isCompositionEligible(order: CompositionOrder | undefined): order is CompositionOrder {
  if (!order || order.origin !== "hospitality_booking" || order.requiresDelivery === false || !order.lines?.length) return false;
  return order.lines.every(line => Boolean(text(line.sourceMenuItemId)) && (REUSABLE_WORKSTREAMS as readonly string[]).includes(line.workstream || "")
    && line.allergenEvidenceStatus !== "conflicting" && line.approvedAllergenSnapshot?.allergenEvidenceStatus !== "conflicting" && line.status !== "exception" && !(line.exceptions && line.exceptions.length));
}

export function compositionEntryForLine(line: CompositionLine): CompositionEntry {
  const snapshot = line.approvedAllergenSnapshot;
  return {
    itemId: text(line.sourceMenuItemId),
    offeringId: text(line.sourceOfferingId) || null,
    choices: (line.choices || []).map(choice => canonicalJson(normaliseChoiceValue(choice))).sort(),
    production: { substitution: text(line.substitution), instructions: text(line.productionInstructions), servingGuidance: text(line.servingGuidance), description: text(line.description) },
    evidenceStatus: line.allergenEvidenceStatus || null,
    allergenInputs: snapshot ? { states: Object.fromEntries(Object.entries(normaliseOperationalAllergens(snapshot.allergens || {})).sort(([a], [b]) => a.localeCompare(b))), evidence: snapshot.allergenEvidenceStatus || null, mayContainNotes: text(snapshot.mayContainNotes) } : null,
  };
}
export const entryKey = (entry: CompositionEntry) => canonicalJson(entry);

/** The deterministic composition identity, or `undefined` when the order cannot safely be given one (fresh review applies). */
export function compositionIdentity(order: CompositionOrder | undefined): CompositionIdentity | undefined {
  if (!isCompositionEligible(order)) return undefined;
  // Set semantics: the same item listed twice (for example in two lines with different quantities) is one composition member.
  const unique = new Map(order.lines.map(line => compositionEntryForLine(line)).map(entry => [entryKey(entry), entry] as const));
  const entries = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
  return { compositionId: sha256(`${COMPOSITION_IDENTITY_VERSION}\n${canonicalJson(entries)}`), identityVersion: COMPOSITION_IDENTITY_VERSION, entries };
}

export type ApprovedSubItem = { productionItemId: string | null; allergens: Record<string, string>; mayContainNotes: string; /** display only; excluded from the semantic hash */ displayName: string };
export type ApprovedMatrixLine = { entryKey: string; subItems: ApprovedSubItem[] };

const normaliseStates = (states: Record<string, string>) => Object.fromEntries(Object.entries(normaliseOperationalAllergens(states)).sort(([a], [b]) => a.localeCompare(b)));
const semanticSubItem = (sub: ApprovedSubItem) => ({ productionItemId: sub.productionItemId, allergens: sub.allergens, mayContainNotes: sub.mayContainNotes });
export const matrixSemanticHash = (lines: ApprovedMatrixLine[]) => sha256(canonicalJson(lines.map(line => ({ entryKey: line.entryKey, subItems: line.subItems.map(semanticSubItem).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1)) }))));

/**
 * The plan's reviewed matrix keyed by composition member (not by booking line ID), with display names/quantities dropped.
 * `undefined` when the matrix is incomplete (an unrecorded state is never carried forward as clear) or ambiguous.
 */
export function captureApprovedMatrix(plan: Pick<ProductionPlan, "menuItems">, order: CompositionOrder): { lines: ApprovedMatrixLine[]; semanticHash: string } | undefined {
  if (!isCompositionEligible(order) || !isProductionPlanMatrixComplete(plan.menuItems)) return undefined;
  const lineById = new Map(order.lines.map(line => [line.canonicalId, line]));
  const byKey = new Map<string, ApprovedMatrixLine>();
  for (const item of plan.menuItems) {
    const line = item.sourceLineId ? lineById.get(item.sourceLineId) : undefined;
    if (!line) return undefined;
    const key = entryKey(compositionEntryForLine(line));
    const subItems: ApprovedSubItem[] = item.subItems.map(sub => ({ productionItemId: sub.productionItemId || null, allergens: normaliseStates(sub.allergens), mayContainNotes: text(sub.mayContainNotes), displayName: sub.name.trim() }));
    if (subItems.some(sub => !isCompleteOperationalAllergenMap(sub.allergens))) return undefined;
    const existing = byKey.get(key);
    if (existing && matrixSemanticHash([{ ...existing }]) !== matrixSemanticHash([{ entryKey: key, subItems }])) return undefined; // the same member reviewed two different ways
    if (!existing) byKey.set(key, { entryKey: key, subItems });
  }
  const identity = compositionIdentity(order)!;
  const lines = identity.entries.map(entry => byKey.get(entryKey(entry))).filter((line): line is ApprovedMatrixLine => Boolean(line));
  if (lines.length !== identity.entries.length) return undefined;
  return { lines, semanticHash: matrixSemanticHash(lines) };
}

export type AuthorityOrigin = {
  orderId: string; planId: string; sourceBookingId?: string; quoteRevisionId?: string;
  releaseId: string; releaseVersion: number; matrixContentHash: string; signedMenuContentHash?: string; signedAt: string;
  signatures: Array<{ role: string; printedName: string; signedAt: string }>;
};
export type AuthorityCascade = { startedAt: string; completedAt?: string; adopters: Record<string, { sequence?: number; done?: boolean; doneAt?: string }> };
/**
 * One approved authority per composition, versioned by `generation`. Each generation is immutable once approved: a revocation
 * archives it, and a later re-approval is a NEW generation. Adopters bind to a specific generation, release and matrix hash, so
 * an adopter of an earlier generation can never become valid against a later one.
 */
export type AllergenCompositionAuthority = {
  schema: typeof AUTHORITY_SCHEMA;
  compositionId: string; identityVersion: string; entries: CompositionEntry[];
  generation: number;
  status: "active" | "revoked";
  approvedMatrix: ApprovedMatrixLine[]; matrixSemanticHash: string;
  origin: AuthorityOrigin;
  /** Set atomically with status revoked when the current generation is revoked; it is the durable revocation intent. */
  revocation?: { generation: number; releaseId: string; at: string; by: string; reason: string };
  /** True while any revoked generation still has an incomplete adopter cascade; drives reconciliation. */
  cascadePending: boolean;
  /** Revoked earlier generations (append-only, immutable). */
  generations: Array<{ generation: number; origin: AuthorityOrigin; matrixSemanticHash: string; approvedAt: string; revokedAt: string; reason: string }>;
  /** Adopter registry per generation. An entry is written in the SAME transaction as the adopting plan and its release, so it only ever records committed adoptions. */
  reusedBy: Array<{ orderId: string; generation: number; at: string; by: string }>;
  /** Durable, observable cascade progress keyed by generation. */
  cascades: Record<string, AuthorityCascade>;
  createdAt: string;
  history: Array<{ action: "approved" | "re-approved" | "revoked" | "reused" | "cascade-completed"; at: string; by: string; reason?: string; releaseId?: string; generation?: number }>;
};

type SignedPlanView = Pick<ProductionPlan, "menuItems" | "signedSignatures" | "currentAllergenRelease" | "signedMenuContentHash" | "id" | "orderId">;

/** Builds the authority a fully signed Hospitality plan establishes, or `undefined` if it cannot safely establish one. */
export function buildAuthorityFromSignedPlan(plan: SignedPlanView, order: CompositionOrder & { sourceBookingId?: string; sourceQuoteRevisionId?: string }, at: string, by: string): AllergenCompositionAuthority | undefined {
  const identity = compositionIdentity(order);
  const release = plan.currentAllergenRelease;
  if (!identity || !release || !["current", "pending"].includes(release.status)) return undefined;
  // The composition is stamped on the release when it is signed. A release signed before that, or for a composition that has
  // since changed, can never establish an authority for the order's CURRENT composition.
  if (release.compositionId !== identity.compositionId) return undefined;
  const signatures = plan.signedSignatures || release.signatures || [];
  if (!signatures.some(s => s.role === "production_chef") || !signatures.some(s => s.role === "head_chef_site_manager")) return undefined;
  const captured = captureApprovedMatrix(plan, order);
  if (!captured) return undefined;
  return {
    schema: AUTHORITY_SCHEMA, compositionId: identity.compositionId, identityVersion: identity.identityVersion, entries: identity.entries,
    generation: 1, status: "active", cascadePending: false, approvedMatrix: captured.lines, matrixSemanticHash: captured.semanticHash,
    origin: { orderId: plan.orderId, planId: plan.id, ...(order.sourceBookingId ? { sourceBookingId: order.sourceBookingId } : {}), ...(order.sourceQuoteRevisionId ? { quoteRevisionId: order.sourceQuoteRevisionId } : {}), releaseId: release.releaseId, releaseVersion: release.version, matrixContentHash: release.matrixContentHash, ...(plan.signedMenuContentHash ? { signedMenuContentHash: plan.signedMenuContentHash } : {}), signedAt: release.signedAt, signatures: signatures.map(s => ({ role: s.role, printedName: s.printedName, signedAt: s.signedAt })) },
    generations: [], reusedBy: [], cascades: {}, createdAt: at, history: [{ action: "approved", at, by, releaseId: release.releaseId, generation: 1 }],
  };
}

export type ReuseRefusal = "composition_unavailable" | "authority_missing" | "authority_revoked" | "composition_mismatch" | "identity_version_mismatch" | "own_authority" | "plan_already_signed" | "plan_not_reviewable" | "authority_integrity_failed" | "origin_signatures_missing" | "authority_lookup_failed";
export type ReuseDecision = { ok: true; identity: CompositionIdentity } | { ok: false; reason: ReuseRefusal };

const REVIEWABLE: ProductionPlan["status"][] = ["draft", "planning", "needs_clarification"];

/** Whether `authority` may be applied to this order's plan. Pure; never mutates. */
export function evaluateReuse(order: CompositionOrder | undefined, plan: Pick<ProductionPlan, "status" | "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "signedMatrixArtifact" | "reusedAllergenAuthority">, authority: AllergenCompositionAuthority | undefined): ReuseDecision {
  const identity = compositionIdentity(order);
  if (!identity) return { ok: false, reason: "composition_unavailable" };
  if (!authority) return { ok: false, reason: "authority_missing" };
  if (authority.status !== "active") return { ok: false, reason: "authority_revoked" };
  if (authority.identityVersion !== identity.identityVersion) return { ok: false, reason: "identity_version_mismatch" };
  if (authority.compositionId !== identity.compositionId) return { ok: false, reason: "composition_mismatch" };
  if (authority.origin.orderId === order!.canonicalId) return { ok: false, reason: "own_authority" };
  if (hasOwnSignedAuthority(plan)) return { ok: false, reason: "plan_already_signed" };
  if (!REVIEWABLE.includes(plan.status) && plan.reusedAllergenAuthority?.compositionId !== identity.compositionId) return { ok: false, reason: "plan_not_reviewable" };
  if (!authority.origin.signatures.some(s => s.role === "production_chef") || !authority.origin.signatures.some(s => s.role === "head_chef_site_manager")) return { ok: false, reason: "origin_signatures_missing" };
  const complete = authority.approvedMatrix.length === identity.entries.length && authority.approvedMatrix.every(line => line.subItems.length > 0 && line.subItems.every(sub => isCompleteOperationalAllergenMap(sub.allergens)));
  if (!complete || matrixSemanticHash(authority.approvedMatrix) !== authority.matrixSemanticHash || authority.approvedMatrix.map(l => l.entryKey).join("|") !== identity.entries.map(entryKey).join("|")) return { ok: false, reason: "authority_integrity_failed" };
  return { ok: true, identity };
}

/** Provenance recorded on the REUSING plan. It points back at the origin authority; it is never a signature of this booking. */
export type ReusedAllergenAuthority = {
  /** `${compositionId}#g${generation}`: the exact immutable authority generation this booking adopted. */
  authorityId: string; compositionId: string; generation: number; identityVersion: string; matrixSemanticHash: string;
  /** Canonical order line id -> composition entry key, fixed at adoption and immutable for the generation. It keeps each reviewed sub-item attached to its own line. */
  lineBindings: Record<string, string>;
  adoptedAt: string; adoptedBy: string;
  origin: AuthorityOrigin;
};

/** Applies the approved states to this plan (a new object). Signatures, release and artifacts are never copied or created. */
export function applyReusedAuthority(plan: ProductionPlan, order: CompositionOrder, authority: AllergenCompositionAuthority, input: { by: string; at: string }): ProductionPlan {
  const decision = evaluateReuse(order, plan, authority);
  if (!decision.ok) throw Object.assign(new Error(`The approved allergen authority cannot be reused (${decision.reason}).`), { status: 409, code: `CPU_ALLERGEN_REUSE_${decision.reason.toUpperCase()}` });
  const approvedByKey = new Map(authority.approvedMatrix.map(line => [line.entryKey, line]));
  const next = structuredClone(plan);
  next.menuItems = plan.menuItems.map((item, index): PlannedMenuItem => {
    const line = order.lines.find(candidate => candidate.canonicalId === item.sourceLineId);
    const approved = line ? approvedByKey.get(entryKey(compositionEntryForLine(line))) : undefined;
    if (!approved) throw Object.assign(new Error("A plan line has no matching approved composition member."), { status: 409, code: "CPU_ALLERGEN_REUSE_COMPOSITION_MISMATCH" });
    const existing = plan.menuItems[index].subItems;
    return { ...item, subItems: approved.subItems.map((sub, subIndex) => ({ id: `sub-item:${plan.orderId}:${index + 1}:${subIndex + 1}`, ...(sub.productionItemId ? { productionItemId: sub.productionItemId } : {}), name: sub.displayName || item.name, quantity: existing[subIndex]?.quantity ?? existing[0]?.quantity ?? null, allergens: { ...sub.allergens } as PlannedSubItem["allergens"], ...(sub.mayContainNotes ? { mayContainNotes: sub.mayContainNotes } : {}), note: "", evidenceStatus: "completed" as const })) };
  });
  next.status = "planned";
  const lineBindings = Object.fromEntries(next.menuItems.map(item => { const line = order.lines.find(candidate => candidate.canonicalId === item.sourceLineId); return [item.sourceLineId as string, entryKey(compositionEntryForLine(line!))] as const; }));
  next.reusedAllergenAuthority = { authorityId: `${authority.compositionId}#g${authority.generation}`, compositionId: authority.compositionId, generation: authority.generation, lineBindings, identityVersion: authority.identityVersion, matrixSemanticHash: authority.matrixSemanticHash, adoptedAt: input.at, adoptedBy: input.by, origin: structuredClone(authority.origin) };
  next.updatedAt = input.at; next.updatedBy = input.by;
  next.audit = [...next.audit, { action: "allergen-authority-reused", at: input.at, by: input.by, reason: `Composition matches a previously approved sandwich set (origin release ${authority.origin.releaseId}); this booking was not signed itself.` }];
  return next;
}

/** Whether the provenance on a plan still describes the plan it sits on (same composition and unchanged approved states). */
export function reuseStillValid(plan: Pick<ProductionPlan, "menuItems" | "reusedAllergenAuthority">, order: CompositionOrder | undefined): boolean {
  const reuse = plan.reusedAllergenAuthority;
  if (!reuse) return false;
  const identity = compositionIdentity(order);
  if (!identity || identity.compositionId !== reuse.compositionId || identity.identityVersion !== reuse.identityVersion) return false;
  const captured = order ? captureApprovedMatrix(plan, order) : undefined;
  return Boolean(captured && captured.semanticHash === reuse.matrixSemanticHash);
}

/** Drops reuse provenance (the booking falls back to ordinary review). Mutates `plan`; returns whether anything changed. */
export function clearReuse(plan: ProductionPlan, input: { by: string; at: string; reason: string; /** The approval itself is gone: the copied states must be reviewed again, never read as completed. */ reviewAgain?: boolean }) {
  if (!plan.reusedAllergenAuthority) return false;
  plan.reusedAllergenAuthority = undefined;
  if (input.reviewAgain) for (const item of plan.menuItems) for (const sub of item.subItems) sub.evidenceStatus = "requires_review";
  if (plan.status === "planned" && !hasOwnSignedAuthority(plan)) plan.status = "planning";
  plan.audit.push({ action: "allergen-reuse-invalidated", at: input.at, by: input.by, reason: input.reason });
  return true;
}

export type ReuseValidity = { valid: true } | { valid: false; reason: string };
/**
 * THE authoritative validity test for a reused approval. Every path that can expose, materialize, project, download or act on
 * a reused release must pass through it (see allergen-reuse-service `validateReusedApproval`). Pure.
 *
 * Valid only if the adopter is bound to the authority's CURRENT, ACTIVE generation (same origin release and matrix hash), the
 * composition and live matrix still match, the adopter's registration is committed, and no revocation intent is outstanding.
 */
export function reuseValidity(plan: Pick<ProductionPlan, "orderId" | "menuItems" | "reusedAllergenAuthority">, order: CompositionOrder | undefined, authority: AllergenCompositionAuthority | undefined): ReuseValidity {
  const reuse = plan.reusedAllergenAuthority;
  if (!reuse) return { valid: false, reason: "no_reuse_provenance" };
  if (!authority) return { valid: false, reason: "authority_missing" };
  if (authority.compositionId !== reuse.compositionId) return { valid: false, reason: "composition_mismatch" };
  if (authority.status !== "active" || authority.revocation) return { valid: false, reason: "authority_revoked" };
  if (authority.generation !== reuse.generation) return { valid: false, reason: "generation_mismatch" };
  if (authority.origin.releaseId !== reuse.origin.releaseId) return { valid: false, reason: "origin_release_mismatch" };
  if (authority.matrixSemanticHash !== reuse.matrixSemanticHash) return { valid: false, reason: "matrix_hash_mismatch" };
  if (!reuseStillValid(plan, order)) return { valid: false, reason: "composition_or_matrix_changed" };
  const registration = authority.reusedBy.find(entry => entry.orderId === plan.orderId && entry.generation === reuse.generation);
  if (!registration) return { valid: false, reason: "adoption_not_registered" };
  return { valid: true };
}

type SemanticSubItem = { productionItemId?: string | null; allergens: Record<string, string>; mayContainNotes?: string };
const semanticKey = (sub: SemanticSubItem) => canonicalJson({ productionItemId: sub.productionItemId || null, allergens: normaliseStates(sub.allergens || {}), mayContainNotes: text(sub.mayContainNotes) });
const sortedUnique = (keys: string[]) => [...new Set(keys)].sort();

/**
 * THE line-aware semantic matrix. Maps each canonical line key to the sorted, de-duplicated allergen statements of ITS OWN
 * reviewed sub-items. Names, quantities, sub-item ids and ordering never participate, but the association between a canonical
 * line and its sub-items always does, so moving an approved sub-item from line A to line B changes the representation even
 * when the plan's flattened set of statements is unchanged.
 *
 * Line key = the stable canonical order-line id (`sourceLineId`); a row with no line id is keyed by its own row id.
 * Used by BOTH the reused-plan-versus-authority check and automatic origin-authority invalidation.
 */
export const lineKeyOf = (item: { sourceLineId?: string; id: string }) => item.sourceLineId || `row:${item.id}`;
export function lineAwareSemanticMatrix(menuItems: Array<{ sourceLineId?: string; id: string; subItems: SemanticSubItem[] }>): Record<string, string[]> {
  const byLine = new Map<string, string[]>();
  for (const item of menuItems) byLine.set(lineKeyOf(item), [...(byLine.get(lineKeyOf(item)) || []), ...item.subItems.map(semanticKey)]);
  return Object.fromEntries([...byLine.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, keys]) => [key, sortedUnique(keys)]));
}
/** The authority matrix in the same shape, keyed by composition entry key. */
export const authorityEntrySemanticMatrix = (approvedMatrix: ApprovedMatrixLine[]): Record<string, string[]> =>
  Object.fromEntries([...approvedMatrix].sort((a, b) => (a.entryKey < b.entryKey ? -1 : a.entryKey > b.entryKey ? 1 : 0)).map(line => [line.entryKey, sortedUnique(line.subItems.map(semanticKey))]));
/** Whether the allergen statements of ANY canonical line changed (including moving statements between lines). */
export const lineAwareMatrixChanged = (before: Parameters<typeof lineAwareSemanticMatrix>[0], after: Parameters<typeof lineAwareSemanticMatrix>[0]) => JSON.stringify(lineAwareSemanticMatrix(before)) !== JSON.stringify(lineAwareSemanticMatrix(after));

/**
 * Line-by-line comparison of a reused plan with its authority matrix. Every plan line must be bound to a composition entry,
 * its own sub-items must equal THAT entry's approved sub-items, and every approved entry must be covered by at least one line.
 * Returns a mismatch description, or undefined when the persisted matrix is the approved one.
 */
export function reusedMatrixMismatch(menuItems: Array<{ sourceLineId?: string; id: string; subItems: SemanticSubItem[] }>, lineBindings: Record<string, string> | undefined, approvedMatrix: ApprovedMatrixLine[]): string | undefined {
  if (!lineBindings || !Object.keys(lineBindings).length) return "line_bindings_missing";
  const planLines = lineAwareSemanticMatrix(menuItems);
  const entries = authorityEntrySemanticMatrix(approvedMatrix);
  const covered = new Set<string>();
  for (const [lineKey, statements] of Object.entries(planLines)) {
    const entryKey = lineBindings[lineKey];
    if (!entryKey) return `line_unbound:${lineKey}`;
    const approved = entries[entryKey];
    if (!approved) return `entry_unknown:${lineKey}`;
    if (JSON.stringify(statements) !== JSON.stringify(approved)) return `line_matrix_mismatch:${lineKey}`;
    covered.add(entryKey);
  }
  for (const entryKey of Object.keys(entries)) if (!covered.has(entryKey)) return "entry_not_covered";
  return undefined;
}
