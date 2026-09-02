import type { OperationalAllergenState } from "../../../shared/allergen-contract";
export type PlanStatus = "draft" | "planning" | "planned" | "rejected" | "needs_clarification";
export type AllergenCellState = OperationalAllergenState;
export type PlannedSubItem = {
  id: string;
  productionItemId?: string;
  name: string;
  quantity: number | null;
  allergens: Record<string, AllergenCellState>;
  mayContainNotes?: string;
  note: string;
  evidenceStatus: "not_completed" | "completed" | "requires_review";
};
export type PlannedMenuItem = { id: string; sourceLineId?: string; name: string; note: string; subItems: PlannedSubItem[] };
export type InternalMatrixSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor: string; attestation: string; signatureDataUrl?: string };
export type MatrixArtifact = { id: string; bookingId: string; fileName: string; createdAt: string; createdBy: string; contentHash: string; html?: string; pdfPath?: string; localUrl?: string; pdfStatus: "generated" | "unavailable"; driveFileId?: string; driveUrl?: string; driveStatus: "saved" | "not_configured" | "failed" };
/** A production menu item may contain several separately checked sub-items. */
export type ProductionPlan = { id: string; orderId: string; status: PlanStatus; acceptedBy?: string; acceptedAt?: string; rejectionReason?: string; clarificationNote?: string; menuItems: PlannedMenuItem[]; planningNotes: string; signatures?: InternalMatrixSignature[]; matrixArtifact?: MatrixArtifact; masterMatrixArtifact?: MatrixArtifact; siteMatrixArtifacts?: Record<string, MatrixArtifact>; signedMenuContentHash?: string; signedSignatures?: InternalMatrixSignature[]; signedMatrixArtifact?: MatrixArtifact; updatedAt: string; updatedBy: string; audit: Array<{ action: string; at: string; by: string; reason?: string }> };
