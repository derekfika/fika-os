import { z } from "zod";

const id = z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9:_-]+$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}, "Use a real calendar date in YYYY-MM-DD format.");

export const lifecycleSchema = z.enum(["idea", "in_development", "ready_for_approval", "brand_review", "approved", "asset_generation", "rollout", "live", "review", "archived", "retired"]);
export const classificationSchema = z.enum(["classic_source", "fika_original", "draft_concept"]);
export const approvalKindSchema = z.enum(["operational", "brand"]);
export const approvalDecisionSchema = z.enum(["pending", "approved", "rejected", "changes_requested"]);
export const MAX_PASTED_RECIPE_CANDIDATES = 20;
export const MAX_RECIPE_DOCUMENT_BYTES = 4 * 1024 * 1024;
const importHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const importIndexSchema = z.number().int().min(0).max(MAX_PASTED_RECIPE_CANDIDATES - 1);
const importSourceCandidateSchema = z.object({ index: importIndexSchema, hash: importHashSchema }).strict();
export const recipeDocumentFormatSchema = z.enum(["docx", "pptx", "pdf"]);
const documentImportEvidenceSchema = z.object({
  format: recipeDocumentFormatSchema,
  byteLength: z.number().int().min(1).max(MAX_RECIPE_DOCUMENT_BYTES),
  adapterVersion: z.string().min(1).max(40),
  textHash: importHashSchema,
}).strict();

export const ingredientLineSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  quantityMilli: z.number().int().positive().max(1_000_000_000).optional(),
  amount: z.number().positive().max(1_000_000).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  unitCostMicropounds: z.number().int().nonnegative().max(1_000_000_000).optional(),
  costPerUnit: z.number().nonnegative().max(1_000).optional(),
  costUnit: z.string().trim().min(1).max(24).optional(),
  sourceStatus: z.enum(["deferred", "confirmed"]),
}).strict().superRefine((line, context) => {
  if (line.quantityMilli !== undefined && line.amount !== undefined && line.quantityMilli !== Math.round(line.amount * 1000)) context.addIssue({ code: "custom", message: "Quantity fields disagree.", path: ["quantityMilli"] });
  if (line.unitCostMicropounds !== undefined && line.costPerUnit !== undefined && line.unitCostMicropounds !== Math.round(line.costPerUnit * 1_000_000)) context.addIssue({ code: "custom", message: "Unit cost fields disagree.", path: ["unitCostMicropounds"] });
  if (line.costUnit && line.unit && line.costUnit.toLowerCase() !== line.unit.toLowerCase()) context.addIssue({ code: "custom", message: "Cost basis unit must match the recipe unit.", path: ["costUnit"] });
});

export const approvalSchema = z.object({
  id,
  kind: approvalKindSchema,
  decision: approvalDecisionSchema,
  actorId: id,
  notes: z.string().max(2000).optional(),
  createdAt: z.string().datetime(),
}).strict();

export const beverageVersionSchema = z.object({
  id,
  number: z.number().int().positive(),
  status: z.enum(["prototype", "approval_candidate", "approved", "superseded"]),
  recipeNotes: z.string().max(4000),
  method: z.string().max(8000),
  ingredients: z.array(ingredientLineSchema).max(100),
  equipment: z.array(z.string().trim().min(1).max(160)).max(40),
  allergenStatus: z.enum(["not_assessed", "awaiting_canonical_source", "reviewed"]),
  allergens: z.array(z.string().trim().min(1).max(120)).max(100),
  costing: z.object({
    currency: z.literal("GBP").optional(),
    basis: z.literal("per-serving-ex-vat").optional(),
    costStatus: z.enum(["complete", "incomplete"]).optional(),
    costPerPortionPence: z.number().int().nonnegative().nullable().optional(),
    sellingPriceExVatPence: z.number().int().positive().nullable().optional(),
    grossProfitPence: z.number().int().nullable().optional(),
    grossProfitBasisPoints: z.number().int().nullable().optional(),
    // Read-only compatibility fields for the pre-Stage B development UI.
    costPerPortion: z.number().nonnegative().optional(),
    targetPrice: z.number().positive().optional(),
    vatRate: z.number().nonnegative().max(1).optional(),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  createdByRole: z.string().max(80),
  createdBy: id.optional(),
  supersededAt: z.string().datetime().optional(),
}).strict();

const readinessSchema = z.object({ equipment: z.boolean(), ingredients: z.enum(["deferred", "ready"]), training: z.boolean(), assets: z.boolean() }).strict();
export const siteRolloutSchema = z.object({
  id,
  oplocId: id,
  siteLabel: z.string().trim().min(1).max(160),
  state: z.enum(["not_started", "blocked", "in_progress", "ready", "live", "ended"]),
  launchDate: dateOnly.optional(),
  endDate: dateOnly.optional(),
  localPrice: z.number().nonnegative().optional(),
  blockers: z.array(z.string().trim().min(1).max(500)).max(40),
  readiness: readinessSchema,
}).strict();

export const beverageRecordSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  beverageType: z.string().trim().min(1).max(80),
  season: z.string().trim().max(80).optional(),
  lifecycle: lifecycleSchema,
  ownerRole: z.literal("Beverage developer"),
  concept: z.object({ inspiration: z.string().max(2000).optional(), flavourDirection: z.string().max(2000).optional(), useCase: z.string().max(2000).optional(), serviceFormat: z.string().max(2000).optional(), seasonalContext: z.string().max(2000).optional(), notes: z.string().max(4000).optional() }).strict(),
  currentVersionId: id.optional(),
  versions: z.array(beverageVersionSchema).max(100),
  schemaVersion: z.literal(2),
  aggregateVersion: z.number().int().positive(),
  classification: classificationSchema,
  derivedFrom: z.object({ beverageId: id, versionId: id }).strict().optional(),
  normalizedName: z.string().trim().min(1).max(160),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: id,
  updatedBy: id,
  sourceEvidence: z.object({
    fileName: z.string().max(240),
    importedAt: z.string().datetime(),
    sourceKey: z.string().max(240),
    candidate: importSourceCandidateSchema.optional(),
    document: documentImportEvidenceSchema.optional(),
  }).strict().optional(),
  prototypes: z.array(z.object({ id, name: z.string().min(1).max(160), notes: z.string().max(2000), outcome: z.enum(["promising", "needs_work", "not_progressing"]).optional(), versionId: id.optional(), createdAt: z.string().datetime() }).strict()).max(200),
  rollouts: z.array(siteRolloutSchema).max(200),
  approvals: z.array(approvalSchema).max(200),
  assets: z.array(z.object({ id, type: z.enum(["photo", "recipe_card", "service_guide", "social"]), status: z.enum(["missing", "draft", "ready", "approved"]), reference: z.string().max(1000).optional() }).strict()).max(100),
  feedback: z.array(z.object({ id, siteLabel: z.string().max(160), note: z.string().max(4000), severity: z.enum(["low", "medium", "high"]), createdAt: z.string().datetime() }).strict()).max(500),
}).strict().superRefine((record, context) => {
  const ids = new Set<string>();
  for (const version of record.versions) {
    if (ids.has(version.id)) context.addIssue({ code: "custom", message: "Version IDs must be unique.", path: ["versions"] });
    ids.add(version.id);
  }
  if (record.currentVersionId && !ids.has(record.currentVersionId)) context.addIssue({ code: "custom", message: "Current version must exist in the version history.", path: ["currentVersionId"] });
});

export const editableBeveragePatchSchema = z.object({
  name: beverageRecordSchema.shape.name,
  description: beverageRecordSchema.shape.description,
  beverageType: beverageRecordSchema.shape.beverageType,
  season: beverageRecordSchema.shape.season,
  concept: beverageRecordSchema.shape.concept,
  classification: beverageRecordSchema.shape.classification,
}).partial().strict();

export const monthlySpecialDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  beverageId: id,
  beverageVersionId: id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  startDate: dateOnly,
  endDate: dateOnly,
  targetSites: z.array(z.object({ oplocId: id, siteLabelSnapshot: z.string().trim().min(1).max(160), assigned: z.boolean(), blockers: z.array(z.string().max(500)).max(40) }).strict()).max(100),
  notes: z.string().max(4000),
}).strict();

export const editableMonthlySpecialPatchSchema = monthlySpecialDraftSchema.omit({ beverageId: true, beverageVersionId: true }).partial();

export const monthlySpecialSchema = monthlySpecialDraftSchema.extend({
  id,
  schemaVersion: z.literal(1),
  aggregateVersion: z.number().int().positive(),
  status: z.enum(["draft", "scheduled", "live", "ended", "cancelled"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: id,
  updatedBy: id,
}).superRefine((special, context) => {
  if (special.startDate > special.endDate) context.addIssue({ code: "custom", message: "The launch start date must be on or before its end date.", path: ["endDate"] });
  if (special.startDate.slice(0, 7) !== special.month) context.addIssue({ code: "custom", message: "The launch month must match its start date.", path: ["month"] });
});

export const beverageAuditEventSchema = z.object({
  eventId: id,
  action: z.string().trim().min(1).max(120),
  entityType: z.enum(["beverage", "monthly_special"]),
  entityId: id,
  versionBefore: z.number().int().nonnegative(),
  versionAfter: z.number().int().positive(),
  actorId: id,
  sourceApp: z.literal("beverage-innovation"),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(8).max(160),
  summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 30, "Audit summaries are limited to 30 fields."),
}).strict();

export type BeverageRecord = z.infer<typeof beverageRecordSchema>;
export type MonthlySpecialRecord = z.infer<typeof monthlySpecialSchema>;
export type BeverageAuditEvent = z.infer<typeof beverageAuditEventSchema>;
const reviewedImportIngredientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  amount: z.number().min(0.001).max(1_000_000).refine(value => Number(value.toFixed(3)) === value).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
}).strict().refine(line => line.amount === undefined || line.unit !== undefined, { path: ["unit"], message: "Select a unit for the entered quantity." });

export const reviewedImportRecipeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  beverageType: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  ingredients: z.array(reviewedImportIngredientSchema).max(100),
  method: z.string().trim().max(8000),
  glassware: z.string().trim().max(160),
  garnish: z.string().trim().max(3991),
  equipment: z.array(z.string().trim().min(1).max(160)).max(40),
}).strict().refine(recipe => recipe.equipment.length + Number(Boolean(recipe.glassware)) <= 40, { path: ["equipment"], message: "Use at most 40 equipment and glassware entries combined." });

export const localImportPreviewRequestSchema = z.object({ text: z.string() }).strict();
export const localImportReviewSchema = z.object({
  sourceHash: importHashSchema,
  candidateIndex: importIndexSchema,
  candidateHash: importHashSchema,
  classification: classificationSchema,
  reviewed: z.literal(true),
  reviewedCandidate: reviewedImportRecipeSchema,
}).strict();
export const localImportCommitRequestSchema = localImportReviewSchema.extend(localImportPreviewRequestSchema.shape);

export type ReviewedImportRecipe = z.infer<typeof reviewedImportRecipeSchema>;
export type PastedRecipeProvenance = { sourceHash: string; candidate: z.infer<typeof importSourceCandidateSchema> };
export type RecipeDocumentFormat = z.infer<typeof recipeDocumentFormatSchema>;
export type DocumentImportEvidence = z.infer<typeof documentImportEvidenceSchema>;
export type DocumentRecipeProvenance = PastedRecipeProvenance & { sourceLabel: string; document: DocumentImportEvidence };
export type RecipeImportProvenance = PastedRecipeProvenance | DocumentRecipeProvenance;
export type LocalImportReview = z.infer<typeof localImportReviewSchema>;
export type LocalImportCandidate = {
  index: number;
  candidateHash: string;
  recipe: ReviewedImportRecipe;
  confidence: "low" | "medium" | "high";
  warnings: string[];
};
export type LocalImportPreview = { sourceHash: string; sourceLabel: string; candidates: LocalImportCandidate[] };
export type LocalDocumentImportPreview = LocalImportPreview & { document: DocumentImportEvidence };
