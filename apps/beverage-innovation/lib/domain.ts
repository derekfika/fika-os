export type Lifecycle = "idea" | "in_development" | "ready_for_approval" | "brand_review" | "approved" | "asset_generation" | "rollout" | "live" | "review" | "archived" | "retired";
export type RolloutState = "not_started" | "blocked" | "in_progress" | "ready" | "live" | "ended";
export type ApprovalDecision = "pending" | "approved" | "rejected" | "changes_requested";
export type ApprovalKind = "operational" | "brand";

export type IngredientLine = { id: string; name: string; quantity?: string; amount?: number; unit?: string; costPerUnit?: number; sourceStatus: "deferred" | "confirmed" };
export type BeverageVersion = {
  id: string; number: number; status: "prototype" | "approval_candidate" | "approved";
  recipeNotes: string; method: string; ingredients: IngredientLine[]; equipment: string[];
  allergenStatus: "not_assessed" | "awaiting_canonical_source" | "reviewed";
  allergens: string[]; costing?: { costPerPortion?: number; targetPrice?: number; vatRate?: number };
  createdAt: string; createdByRole: string;
};
export type BeveragePrototype = { id: string; name: string; notes: string; outcome?: "promising" | "needs_work" | "not_progressing"; versionId?: string; createdAt: string };
export type ApprovalRecord = { id: string; kind: ApprovalKind; decision: ApprovalDecision; actorRole: string; notes?: string; createdAt: string };
export type BeverageAsset = { id: string; type: "photo" | "recipe_card" | "service_guide" | "social"; status: "missing" | "draft" | "ready" | "approved"; reference?: string };
export type SiteRollout = { id: string; oplocId: string; siteLabel: string; state: RolloutState; launchDate?: string; endDate?: string; localPrice?: number; blockers: string[]; readiness: { equipment: boolean; ingredients: "deferred" | "ready"; training: boolean; assets: boolean } };
export type Feedback = { id: string; siteLabel: string; note: string; severity: "low" | "medium" | "high"; createdAt: string };
export type BeverageConcept = { inspiration?: string; flavourDirection?: string; useCase?: string; serviceFormat?: string; seasonalContext?: string; notes?: string };
export type SourceEvidence = { fileName: string; importedAt: string; sourceKey: string };
export type BeverageInnovation = {
  id: string; name: string; description: string; beverageType: string; season?: string; lifecycle: Lifecycle;
  ownerRole: "Beverage developer"; concept: BeverageConcept; currentVersionId?: string; versions: BeverageVersion[];
  sourceEvidence?: SourceEvidence;
  prototypes: BeveragePrototype[]; rollouts: SiteRollout[]; approvals: ApprovalRecord[]; assets: BeverageAsset[]; feedback: Feedback[];
  audit: { at: string; action: string; actorRole: string }[];
};
export const lifecycleLabel: Record<Lifecycle, string> = { idea:"Idea", in_development:"In development", ready_for_approval:"Ready for approval", brand_review:"Brand review", approved:"Approved", asset_generation:"Asset generation", rollout:"Rollout", live:"Live", review:"Review", archived:"Archived", retired:"Retired" };
export const lifecycleOrder: Lifecycle[] = ["idea","in_development","ready_for_approval","brand_review","approved","asset_generation","rollout","live","review","archived"];
export function canTransition(from: Lifecycle, to: Lifecycle) { const allowed: Record<Lifecycle, Lifecycle[]> = { idea:["in_development","archived"], in_development:["ready_for_approval","archived"], ready_for_approval:["brand_review","in_development"], brand_review:["approved","in_development"], approved:["asset_generation","rollout","archived"], asset_generation:["rollout","approved"], rollout:["live","approved","archived"], live:["review","archived"], review:["rollout","archived"], archived:["idea","retired"], retired:[] }; return allowed[from].includes(to); }
export function transition(record: BeverageInnovation, to: Lifecycle): BeverageInnovation {
  if (!canTransition(record.lifecycle, to)) throw new Error(`Cannot move ${record.lifecycle} to ${to}.`);
  if (to === "approved" && (!record.approvals.some(a => a.kind === "operational" && a.decision === "approved") || !record.approvals.some(a => a.kind === "brand" && a.decision === "approved"))) throw new Error("Operational and brand approval are required before approval.");
  if (to === "live" && record.rollouts.some(r => r.state === "blocked" || r.blockers.length)) throw new Error("Resolve rollout blockers before going live.");
  return { ...record, lifecycle: to, audit: [...record.audit, { at: new Date().toISOString(), action: `lifecycle:${to}`, actorRole: "Beverage developer" }] };
}
export function addApproval(record: BeverageInnovation, kind: ApprovalKind, decision: ApprovalDecision, actorRole: string, notes?: string): BeverageInnovation {
  if (record.lifecycle !== "ready_for_approval" && record.lifecycle !== "brand_review") throw new Error("Approvals are only recorded during the approval stages.");
  const approval: ApprovalRecord = { id: `${record.id}:approval:${Date.now()}`, kind, decision, actorRole, notes, createdAt: new Date().toISOString() };
  return { ...record, approvals: [...record.approvals, approval], audit: [...record.audit, { at: approval.createdAt, action: `${kind}:${decision}`, actorRole }] };
}
export function cloneVersion(record: BeverageInnovation, actorRole = "Beverage developer"): BeverageInnovation {
  const next = (record.versions.at(-1)?.number ?? 0) + 1; const now = new Date().toISOString();
  const previous = record.versions.at(-1); const version: BeverageVersion = { id: `${record.id}:version:${next}`, number: next, status: "prototype", recipeNotes: previous?.recipeNotes ?? "", method: previous?.method ?? "", ingredients: previous?.ingredients ?? [], equipment: previous?.equipment ?? [], allergenStatus: "awaiting_canonical_source", allergens: [], createdAt: now, createdByRole: actorRole };
  return { ...record, lifecycle: "in_development", currentVersionId: version.id, versions: [...record.versions, version], audit: [...record.audit, { at: now, action: `version:${next}`, actorRole }] };
}
export function updateVersion(record: BeverageInnovation, versionId: string, patch: Pick<BeverageVersion, "recipeNotes" | "method" | "ingredients" | "equipment">, actorRole = "Beverage developer"): BeverageInnovation {
  const version = record.versions.find(v => v.id === versionId);
  if (!version) throw new Error("Version not found.");
  if (version.status === "approved") throw new Error("Approved versions are immutable. Create a new version before editing.");
  const at = new Date().toISOString();
  const updated = { ...version, ...patch, costing: { ...(version.costing ?? {}), costPerPortion: patch.ingredients.reduce((sum, item) => sum + (item.amount ?? 0) * (item.costPerUnit ?? 0), 0) } };
  return { ...record, versions: record.versions.map(v => v.id === versionId ? updated : v), audit: [...record.audit, { at, action: `version:${version.number}:updated`, actorRole }] };
}
