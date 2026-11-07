import { createHash } from "node:crypto";
import { addApproval, cloneVersion, transition, updateVersion as updateVersionRecord, type BeverageInnovation, type IngredientLine, type Lifecycle, type ApprovalKind, type ApprovalDecision } from "./domain";
import { beverageRecordSchema, monthlySpecialSchema, type BeverageRecord, type MonthlySpecialRecord } from "./contracts";
import { calculateCosting, normaliseIngredientLine, poundsToPence } from "./costing";
import { commitBeverageCommand, entityIdForCommand, getBeverage, listBeverages, listMonthlySpecials, listBeverageAudit } from "./repository";
import type { BeverageActor } from "./runtime";
import { createMonthlySpecial, transitionMonthlySpecial, updateMonthlySpecial, type SpecialDraft } from "./specials";

function asDomain(record: BeverageRecord): BeverageInnovation { return record as BeverageInnovation; }
const emptyRecord = (id: string, actor: BeverageActor, input: { name: string; description: string; beverageType: string; classification: BeverageRecord["classification"] }, at: string): BeverageRecord => beverageRecordSchema.parse({
  id, ...input, normalizedName: input.name.trim().toLocaleLowerCase("en-GB"), lifecycle: "idea", ownerRole: "Beverage developer", concept: {}, versions: [], schemaVersion: 2,
  aggregateVersion: 1, createdAt: at, updatedAt: at, createdBy: actor.authmodIdentityId, updatedBy: actor.authmodIdentityId,
  prototypes: [], rollouts: [], approvals: [], assets: [], feedback: [],
});

export { getBeverage, listBeverages, listMonthlySpecials, listBeverageAudit };

export async function createBeverage(input: { name: string; description: string; beverageType: string; classification?: BeverageRecord["classification"] }, actor: BeverageActor, expectedVersion: number, idempotencyKey: string) {
  const name = input.name.trim();
  if (!name || !input.description.trim()) throw Object.assign(new Error("Name and description are required."), { status: 400, code: "BEVERAGE_REQUIRED_FIELDS" });
  const id = entityIdForCommand("beverage", actor.authmodIdentityId, idempotencyKey);
  const created = emptyRecord(id, actor, { ...input, name, description: input.description.trim(), classification: input.classification || "draft_concept" }, new Date().toISOString());
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.created", expectedVersion, idempotencyKey, actor, summary: { name, classification: created.classification }, schema: beverageRecordSchema, create: true, mutate: () => created }).then(asDomain);
}
export async function updateBeverage(id: string, patch: Partial<Pick<BeverageRecord, "name" | "description" | "beverageType" | "season" | "concept" | "classification">>, actor: BeverageActor, expectedVersion: number, key: string) {
  if (!Object.keys(patch).length) throw Object.assign(new Error("Supply at least one field to update."), { status: 400, code: "BEVERAGE_PATCH_EMPTY" });
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.updated", expectedVersion, idempotencyKey: key, actor, summary: { fields: Object.keys(patch).join(",") }, schema: beverageRecordSchema, mutate: current => {
    if (!current) throw new Error("Beverage not found.");
    if (current.lifecycle === "archived" || current.lifecycle === "retired") throw Object.assign(new Error("Archived beverage records are read-only."), { status: 409, code: "BEVERAGE_RECORD_IMMUTABLE" });
    const next = { ...current, ...patch, ...(patch.name ? { normalizedName: patch.name.trim().toLocaleLowerCase("en-GB") } : {}) };
    if (patch.name && current.versions.some(version => version.status === "approved")) throw Object.assign(new Error("Create a new version or concept to preserve approved historical evidence; the name cannot be changed after approval."), { status: 409, code: "BEVERAGE_APPROVED_NAME_IMMUTABLE" });
    return next;
  } }).then(asDomain);
}

export async function setLifecycle(id: string, lifecycle: Lifecycle, actor: BeverageActor, expectedVersion: number, key: string) {
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.lifecycle", expectedVersion, idempotencyKey: key, actor, summary: { lifecycle }, schema: beverageRecordSchema, mutate: current => { if (!current) throw new Error("Beverage not found."); return transition(asDomain(current), lifecycle) as BeverageRecord; } }).then(asDomain);
}

export async function recordApproval(id: string, kind: ApprovalKind, decision: ApprovalDecision, actor: BeverageActor, expectedVersion: number, key: string, notes?: string) {
  const approvalId = `approval:${createHash("sha256").update(`${actor.authmodIdentityId}\0${key}`).digest("hex").slice(0, 40)}`;
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.approval", expectedVersion, idempotencyKey: key, actor, summary: { kind, decision }, schema: beverageRecordSchema, mutate: (current, at) => { if (!current) throw new Error("Beverage not found."); return addApproval(asDomain(current), kind, decision, actor.authmodIdentityId, notes, { id: approvalId, at }) as BeverageRecord; } }).then(asDomain);
}

export async function createVersion(id: string, actor: BeverageActor, expectedVersion: number, key: string) {
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.version.created", expectedVersion, idempotencyKey: key, actor, summary: { change: "new_version" }, schema: beverageRecordSchema, mutate: current => { if (!current) throw new Error("Beverage not found."); return cloneVersion(asDomain(current), actor.authmodIdentityId) as BeverageRecord; } }).then(asDomain);
}

export async function updateVersion(id: string, versionId: string, patch: { recipeNotes: string; method: string; ingredients: IngredientLine[]; equipment: string[]; sellingPriceExVat?: string }, actor: BeverageActor, expectedVersion: number, key: string) {
  const ingredients = patch.ingredients.map(normaliseIngredientLine);
  const current = await getBeverage(id);
  const version = current?.versions.find(item => item.id === versionId);
  if (!version) throw Object.assign(new Error("Version not found."), { status: 404, code: "BEVERAGE_VERSION_NOT_FOUND" });
  if (version.status === "approved" || version.status === "superseded") throw Object.assign(new Error("Approved and superseded recipe versions are immutable. Create a new version before editing."), { status: 409, code: "BEVERAGE_VERSION_IMMUTABLE" });
  const priorPrice = version.costing?.sellingPriceExVatPence ?? undefined;
  const price = patch.sellingPriceExVat === undefined || patch.sellingPriceExVat === "" ? priorPrice : poundsToPence(patch.sellingPriceExVat);
  const costing = calculateCosting(ingredients, price);
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.version.updated", expectedVersion, idempotencyKey: key, actor, summary: { versionId, ingredientCount: ingredients.length, costStatus: costing.costStatus }, schema: beverageRecordSchema, mutate: record => {
    if (!record) throw new Error("Beverage not found.");
    const updated = updateVersionRecord(asDomain(record), versionId, { recipeNotes: patch.recipeNotes.trim(), method: patch.method.trim(), ingredients, equipment: patch.equipment.map(value => value.trim()).filter(Boolean) }, actor.authmodIdentityId);
    return { ...updated, versions: updated.versions.map(item => item.id === versionId ? { ...item, costing } : item) } as BeverageRecord;
  } }).then(asDomain);
}

export async function createSpecial(input: SpecialDraft, actor: BeverageActor, expectedVersion: number, key: string) {
  const id = entityIdForCommand("special", actor.authmodIdentityId, key);
  const beverage = await getBeverage(input.beverageId);
  if (!beverage) throw Object.assign(new Error("Beverage not found."), { status: 404, code: "BEVERAGE_NOT_FOUND" });
  const special = createMonthlySpecial(input, beverage, actor, id, new Date().toISOString());
  return commitBeverageCommand({ entityType: "monthly_special", collection: "beverageMonthlySpecialsV1", entityId: id, action: "monthly_special.created", expectedVersion, idempotencyKey: key, actor, summary: { month: input.month, beverageId: input.beverageId }, schema: monthlySpecialSchema, create: true, mutate: () => special });
}

export async function createImportedBeverage(candidate: import("./contracts").LocalImportCandidate, sourceHash: string, actor: BeverageActor, key: string) {
  if (!candidate.name.trim()) throw Object.assign(new Error("Review and enter the drink name before creating a local draft."), { status: 422, code: "BEVERAGE_IMPORT_NAME_REQUIRED" });
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw Object.assign(new Error("The import preview source fingerprint is invalid."), { status: 400, code: "BEVERAGE_IMPORT_HASH_INVALID" });
  const id = entityIdForCommand("beverage", actor.authmodIdentityId, key); const at = new Date().toISOString(); const versionId = `${id}:version:1`;
  const lines: IngredientLine[] = candidate.ingredients.map((ingredient, index) => normaliseIngredientLine({ id: `${versionId}:ingredient:${index + 1}`, name: ingredient.name, amount: ingredient.amount, unit: ingredient.unit, sourceStatus: "deferred" }));
  const version = { id: versionId, number: 1, status: "prototype" as const, recipeNotes: candidate.description, method: candidate.method, ingredients: lines, equipment: candidate.glassware ? [candidate.glassware] : [], allergenStatus: "awaiting_canonical_source" as const, allergens: [], costing: calculateCosting(lines), createdAt: at, createdByRole: "Beverage developer", createdBy: actor.authmodIdentityId };
  const created = beverageRecordSchema.parse({ id, name: candidate.name.trim(), normalizedName: candidate.name.trim().toLocaleLowerCase("en-GB"), description: candidate.description || `Imported draft from ${candidate.sourceLabel}.`, beverageType: candidate.beverageType || "Unclassified", lifecycle: "in_development", ownerRole: "Beverage developer", concept: candidate.garnish ? { notes: `Garnish: ${candidate.garnish}` } : {}, currentVersionId: versionId, versions: [version], schemaVersion: 2, aggregateVersion: 1, classification: candidate.classification, sourceEvidence: { fileName: candidate.sourceLabel, importedAt: at, sourceKey: sourceHash }, createdAt: at, updatedAt: at, createdBy: actor.authmodIdentityId, updatedBy: actor.authmodIdentityId, prototypes: [], rollouts: [], approvals: [], assets: [], feedback: [] });
  return commitBeverageCommand({ entityType: "beverage", collection: "beverageRecordsV2", entityId: id, action: "beverage.imported_from_preview", expectedVersion: 0, idempotencyKey: key, actor, summary: { name: created.name, sourceHash }, schema: beverageRecordSchema, create: true, mutate: () => created }).then(asDomain);
}

export async function editSpecial(id: string, patch: Partial<SpecialDraft>, actor: BeverageActor, expectedVersion: number, key: string) {
  return commitBeverageCommand({ entityType: "monthly_special", collection: "beverageMonthlySpecialsV1", entityId: id, action: "monthly_special.updated", expectedVersion, idempotencyKey: key, actor, summary: { fields: Object.keys(patch).join(",") }, schema: monthlySpecialSchema, mutate: current => { if (!current) throw new Error("Monthly special not found."); return updateMonthlySpecial(current, patch, actor, new Date().toISOString()); } });
}

export async function setSpecialStatus(id: string, status: MonthlySpecialRecord["status"], actor: BeverageActor, expectedVersion: number, key: string) {
  return commitBeverageCommand({ entityType: "monthly_special", collection: "beverageMonthlySpecialsV1", entityId: id, action: "monthly_special.status", expectedVersion, idempotencyKey: key, actor, summary: { status }, schema: monthlySpecialSchema, mutate: async current => {
    if (!current) throw new Error("Monthly special not found.");
    const beverage = await getBeverage(current.beverageId);
    if (!beverage) throw Object.assign(new Error("Linked beverage was not found."), { status: 409, code: "BEVERAGE_LINK_MISSING" });
    return transitionMonthlySpecial(current, beverage, status, actor, new Date().toISOString());
  } });
}
