import type { BeverageRecord } from "./contracts";

export type Lifecycle = "idea" | "in_development" | "ready_for_approval" | "brand_review" | "approved" | "asset_generation" | "rollout" | "live" | "review" | "archived" | "retired";
export type RolloutState = "not_started" | "blocked" | "in_progress" | "ready" | "live" | "ended";
export type ApprovalDecision = "pending" | "approved" | "rejected" | "changes_requested";
export type ApprovalKind = "operational" | "brand";

export type IngredientLine = { id: string; name: string; quantity?: string; amount?: number; quantityMilli?: number; unit?: string; costPerUnit?: number; unitCostMicropounds?: number; costUnit?: string; sourceStatus: "deferred" | "confirmed" };
export type BeverageVersion = {
  id: string; number: number; status: "prototype" | "approval_candidate" | "approved" | "superseded";
  recipeNotes: string; method: string; ingredients: IngredientLine[]; equipment: string[];
  allergenStatus: "not_assessed" | "awaiting_canonical_source" | "reviewed";
  allergens: string[]; costing?: { costPerPortion?: number; targetPrice?: number; vatRate?: number; currency?: "GBP"; basis?: "per-serving-ex-vat"; costStatus?: "complete" | "incomplete"; costPerPortionPence?: number | null; sellingPriceExVatPence?: number | null; grossProfitPence?: number | null; grossProfitBasisPoints?: number | null };
  createdAt: string; createdByRole: string; createdBy?: string; supersededAt?: string;
};
export type BeveragePrototype = { id: string; name: string; notes: string; outcome?: "promising" | "needs_work" | "not_progressing"; versionId?: string; createdAt: string };
export type ApprovalRecord = { id: string; kind: ApprovalKind; decision: ApprovalDecision; actorId?: string; actorRole?: string; notes?: string; createdAt: string };
export type BeverageAsset = { id: string; type: "photo" | "recipe_card" | "service_guide" | "social"; status: "missing" | "draft" | "ready" | "approved"; reference?: string };
export type SiteRollout = { id: string; oplocId: string; siteLabel: string; state: RolloutState; launchDate?: string; endDate?: string; localPrice?: number; blockers: string[]; readiness: { equipment: boolean; ingredients: "deferred" | "ready"; training: boolean; assets: boolean } };
export type Feedback = { id: string; siteLabel: string; note: string; severity: "low" | "medium" | "high"; createdAt: string };
export type BeverageConcept = { inspiration?: string; flavourDirection?: string; useCase?: string; serviceFormat?: string; seasonalContext?: string; notes?: string };
export type SourceEvidence = NonNullable<BeverageRecord["sourceEvidence"]>;
export type BeverageClassification = "classic_source" | "fika_original" | "draft_concept";
export type DerivedFrom = { beverageId: string; versionId: string };
export type BeverageInnovation = {
  id: string; name: string; description: string; beverageType: string; season?: string; lifecycle: Lifecycle;
  ownerRole: "Beverage developer"; concept: BeverageConcept; currentVersionId?: string; versions: BeverageVersion[];
  schemaVersion?: 2; aggregateVersion?: number; classification?: BeverageClassification; derivedFrom?: DerivedFrom; normalizedName?: string;
  createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string;
  sourceEvidence?: SourceEvidence;
  prototypes: BeveragePrototype[]; rollouts: SiteRollout[]; approvals: ApprovalRecord[]; assets: BeverageAsset[]; feedback: Feedback[];
};
export const lifecycleLabel: Record<Lifecycle, string> = { idea:"Idea", in_development:"In development", ready_for_approval:"Ready for approval", brand_review:"Brand review", approved:"Approved", asset_generation:"Asset generation", rollout:"Rollout", live:"Live", review:"Review", archived:"Archived", retired:"Retired" };
export const lifecycleOrder: Lifecycle[] = ["idea","in_development","ready_for_approval","brand_review","approved","asset_generation","rollout","live","review","archived"];
export function canTransition(from: Lifecycle, to: Lifecycle) { const allowed: Record<Lifecycle, Lifecycle[]> = { idea:["in_development","archived"], in_development:["ready_for_approval","archived"], ready_for_approval:["brand_review","in_development"], brand_review:["approved","in_development"], approved:["asset_generation","rollout","archived"], asset_generation:["rollout","approved"], rollout:["live","approved","archived"], live:["review","archived"], review:["rollout","archived"], archived:["idea","retired"], retired:[] }; return allowed[from].includes(to); }
export function transition(record: BeverageInnovation, to: Lifecycle): BeverageInnovation {
  if (!canTransition(record.lifecycle, to)) throw new Error(`Cannot move ${record.lifecycle} to ${to}.`);
  if (to === "approved" && (!record.approvals.some(a => a.kind === "operational" && a.decision === "approved") || !record.approvals.some(a => a.kind === "brand" && a.decision === "approved"))) throw new Error("Operational and brand approval are required before approval.");
  if (to === "approved" && (!record.currentVersionId || !record.versions.some(version => version.id === record.currentVersionId))) throw new Error("Final approval requires a current recipe version.");
  if (to === "approved" && !record.assets.some(asset => asset.type === "photo" && asset.status === "approved" && asset.reference?.trim())) throw new Error("Final approval is blocked until an actual drink photograph is reviewed and recorded.");
  if (to === "live" && record.rollouts.some(r => r.state === "blocked" || r.blockers.length)) throw new Error("Resolve rollout blockers before going live.");
  return { ...record, lifecycle: to, ...(to === "approved" && record.currentVersionId ? { versions: record.versions.map(version => version.id === record.currentVersionId ? { ...version, status: "approved" as const } : version) } : {}) };
}
export function addApproval(record: BeverageInnovation, kind: ApprovalKind, decision: ApprovalDecision, actorId: string, notes?: string, metadata: { id?: string; at?: string } = {}): BeverageInnovation {
  if (record.lifecycle !== "ready_for_approval" && record.lifecycle !== "brand_review") throw new Error("Approvals are only recorded during the approval stages.");
  if (!actorId.trim()) throw new Error("A server-authenticated actor is required for an approval decision.");
  const approval: ApprovalRecord = { id: metadata.id || `${record.id}:approval:${Date.now()}`, kind, decision, actorId: actorId.trim(), ...(notes?.trim() ? { notes: notes.trim() } : {}), createdAt: metadata.at || new Date().toISOString() };
  return { ...record, approvals: [...record.approvals, approval] };
}
export function cloneVersion(record: BeverageInnovation, actorId = "fixture:beverage-local-operator"): BeverageInnovation {
  const next = Math.max(0, ...record.versions.map(version => version.number)) + 1; const now = new Date().toISOString();
  const previous = record.versions.find(version => version.id === record.currentVersionId) || record.versions.at(-1);
  const versions = record.versions.map(version => version.id === previous?.id && version.status !== "approved" ? { ...version, status: "superseded" as const, supersededAt: now } : version);
  const version: BeverageVersion = { id: `${record.id}:version:${next}`, number: next, status: "prototype", recipeNotes: previous?.recipeNotes ?? "", method: previous?.method ?? "", ingredients: (previous?.ingredients ?? []).map((line, index) => ({ ...line, id: `${record.id}:version:${next}:ingredient:${index + 1}` })), equipment: [...(previous?.equipment ?? [])], allergenStatus: "awaiting_canonical_source", allergens: [], createdAt: now, createdByRole: "Beverage developer", createdBy: actorId };
  return { ...record, lifecycle: "in_development", currentVersionId: version.id, versions: [...versions, version] };
}
export function updateVersion(record: BeverageInnovation, versionId: string, patch: Pick<BeverageVersion, "recipeNotes" | "method" | "ingredients" | "equipment">, actorId = "fixture:beverage-local-operator"): BeverageInnovation {
  const version = record.versions.find(v => v.id === versionId);
  if (!version) throw new Error("Version not found.");
  if (version.id !== record.currentVersionId || version.status === "approved" || version.status === "superseded") throw new Error("Only the current draft version can be edited. Create a new version before changing historical evidence.");
  const at = new Date().toISOString();
  const updated = { ...version, ...patch, ingredients: patch.ingredients.map(line => ({ ...line })), equipment: [...patch.equipment], createdBy: version.createdBy || actorId };
  return { ...record, versions: record.versions.map(v => v.id === versionId ? updated : v), updatedAt: at };
}
