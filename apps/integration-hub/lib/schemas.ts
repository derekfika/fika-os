import { z } from "zod";
import { CountryCodes, normalisePostalCode } from "./address";

const Id = z.string().min(8).max(160);
const Timestamp = z.iso.datetime();
const ExternalIdentity = z.object({
  provider: z.enum(["brighthr", "square", "spreadsheet"]),
  externalId: z.string().min(1).max(240),
  providerVersion: z.string().max(240).optional(),
  providerUpdatedAt: Timestamp.optional(),
}).strict();
const OptionalDate = z.iso.date().optional();
const LocationTypeName = z.enum(["Site", "Venue"]);
const LocationTypeAssignment = z.object({ assignmentId: Id, locationType: LocationTypeName, effectiveFrom: Timestamp, effectiveTo: Timestamp.optional(), approvedBy: Id, approvedAt: Timestamp, reason: z.string().min(10).max(1000) }).strict();

const Audit = z.object({
  schemaVersion: z.literal("0.1.0"),
  version: z.number().int().positive(),
  createdAt: Timestamp,
  createdBy: Id,
  updatedAt: Timestamp,
  updatedBy: Id,
  active: z.boolean(),
  externalIdentities: z.array(ExternalIdentity),
  provenanceIds: z.array(Id),
}).strict();

const OwnedFields = z.object({
  providerOwned: z.record(z.string(), z.unknown()),
  fikaOwned: z.record(z.string(), z.unknown()),
}).strict();

export const CanonicalSchemas = {
  Legend: Audit.extend({ entityType: z.literal("Legend"), canonicalId: Id, displayName: z.string().min(1), preferredName: z.string().min(1).optional(), workEmail: z.email().optional(), jobTitle: z.string().optional(), employmentState: z.string().optional(), ownership: OwnedFields }).strict(),
  Employment: Audit.extend({ entityType: z.literal("Employment"), canonicalId: Id, legendId: Id, employmentState: z.string().min(1), startDate: OptionalDate, terminationDate: OptionalDate, contractualJobTitle: z.string().optional(), contractHours: z.number().nonnegative().optional(), effectiveFrom: OptionalDate, effectiveTo: OptionalDate, ownership: OwnedFields }).strict(),
  Absence: Audit.extend({ entityType: z.literal("Absence"), canonicalId: Id, legendId: Id, startDate: z.iso.date(), endDate: z.iso.date(), absenceType: z.string().optional(), approvalState: z.string().optional(), ownership: OwnedFields }).strict(),
  // Compatibility validator for the 18 existing provider-derived records. Site is
  // a Location Type, not an accepted canonical entity. New canonical location
  // identities must use OPLOC.
  Site: Audit.extend({ entityType: z.literal("Site"), canonicalId: Id, name: z.string().min(1), operationalLocationId: Id.optional(), address: z.string().optional(), ownership: OwnedFields }).strict(),
  "Site Assignment": Audit.extend({ entityType: z.literal("Site Assignment"), canonicalId: Id, legendId: Id, oplocId: Id, assignmentType: z.string().min(1), designation: z.enum(["primary", "secondary"]), effectiveFrom: OptionalDate, effectiveTo: OptionalDate, assignmentStatus: z.enum(["proposed", "confirmed", "ended"]), confirmedBy: Id.optional(), confirmedAt: Timestamp.optional(), evidenceReferences: z.array(Id), ownership: OwnedFields }).strict(),
  "Source Mapping": Audit.extend({ entityType: z.literal("Source Mapping"), canonicalId: Id, sourceProvider: z.string().min(1), sourceEntityType: z.string().min(1), sourceIdentifier: z.string().min(1), sourceLabel: z.string().optional(), targetCanonicalId: Id.optional(), oplocId: Id.optional(), mappingStatus: z.enum(["unresolved", "confirmed", "rejected", "deferred", "historical", "irrelevant"]), confidence: z.number().min(0).max(1).optional(), decisionReason: z.string().optional(), confirmedBy: Id.optional(), confirmedAt: Timestamp.optional(), ownership: OwnedFields }).strict(),
  "Operational Placement Evidence": Audit.extend({ entityType: z.literal("Operational Placement Evidence"), canonicalId: Id, legendId: Id.optional(), sourceIdentity: z.string().min(1), sourceLocationLabel: z.string().min(1), oplocId: Id.optional(), evidencePeriod: z.enum(["historical", "current", "future-scheduled", "unresolved"]), observedFrom: OptionalDate, observedTo: OptionalDate, sourceReference: Id, reviewStatus: z.enum(["unresolved", "confirmed", "rejected"]), ownership: OwnedFields }).strict(),
  "Operational Assignment": Audit.extend({ entityType: z.literal("Operational Assignment"), canonicalId: Id, legendId: Id, oplocId: Id, assignmentRole: z.string().min(1).max(160), designation: z.enum(["primary", "secondary"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), lifecycleState: z.enum(["active", "ended", "archived"]), evidenceReferences: z.array(Id), decisionReason: z.string().min(10).max(1000), approvedBy: Id, approvedAt: Timestamp, ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Operational Capability": Audit.extend({ entityType: z.literal("Operational Capability"), canonicalId: Id, capabilityName: z.string().min(1).max(160), owningDomainId: Id, businessPurpose: z.string().min(1).max(2000), eligibilitySummary: z.string().max(2000).optional(), lifecycleState: z.enum(["active", "retired"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), decisionReason: z.string().min(10).max(1000), approvedBy: Id, approvedAt: Timestamp, ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Capability Enablement": Audit.extend({ entityType: z.literal("Capability Enablement"), canonicalId: Id, capabilityId: Id, oplocId: Id, state: z.enum(["enabled", "disabled", "unavailable", "ineligible"]), businessOwnerRoleId: Id, effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), configurationReferenceId: Id.optional(), decisionReason: z.string().min(10).max(1000), approvedBy: Id, approvedAt: Timestamp, ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Operational Area Type": Audit.extend({ entityType: z.literal("Operational Area Type"), canonicalId: Id, name: z.string().min(1).max(160), description: z.string().max(1000).optional(), lifecycleState: z.enum(["active", "retired"]), ownership: OwnedFields }).strict(),
  "Operational Area": Audit.extend({ entityType: z.literal("Operational Area"), canonicalId: Id, areaId: Id, oplocId: Id, name: z.string().min(1).max(160), areaTypeId: Id, floorLevel: z.number().int(), description: z.string().max(2000).optional(), lifecycleState: z.enum(["active", "archived"]), aliases: z.array(z.object({ alias: z.string().min(1), sourceReference: z.string().optional(), recordedAt: Timestamp }).strict()), configuration: z.object({ openingHours: z.array(z.object({ day: z.string().min(1).max(40), opensAt: z.string().min(1).max(20), closesAt: z.string().min(1).max(20) }).strict()).optional(), serviceCapabilityIds: z.array(Id).optional(), equipmentAssetIds: z.array(Id).optional(), menuProductReferences: z.array(Id).optional(), stockCountLocationReferences: z.array(Id).optional(), localOperationalInstructions: z.string().max(4000).optional() }).strict().optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.areaId !== value.canonicalId) context.addIssue({ code: "custom", path: ["areaId"], message: "areaId must equal the immutable canonical Operational Area ID." }); }),
  "Service Definition": Audit.extend({ entityType: z.literal("Service Definition"), canonicalId: Id, serviceName: z.string().min(1).max(160), description: z.string().max(1000).optional(), lifecycleState: z.enum(["active", "retired"]), ownership: OwnedFields }).strict(),
  "Service Arrangement": Audit.extend({ entityType: z.literal("Service Arrangement"), canonicalId: Id, oplocId: Id, operationalAreaId: Id.optional(), serviceDefinitionId: Id, lifecycleState: z.enum(["active", "archived"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), operationalNotes: z.string().max(2000).optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Equipment Type": Audit.extend({ entityType: z.literal("Equipment Type"), canonicalId: Id, name: z.string().min(1).max(160), description: z.string().max(1000).optional(), category: z.string().max(160).optional(), lifecycleState: z.enum(["active", "retired"]), ownership: OwnedFields }).strict(),
  "Equipment Asset": Audit.extend({ entityType: z.literal("Equipment Asset"), canonicalId: Id, assetName: z.string().min(1).max(160), equipmentTypeId: Id, manufacturer: z.string().max(160).optional(), model: z.string().max(160).optional(), serialNumber: z.string().max(240).optional(), installationDate: z.iso.date().optional(), warrantyExpiry: z.iso.date().optional(), lifecycleState: z.enum(["active", "retired"]), notes: z.string().max(2000).optional(), ownership: OwnedFields }).strict(),
  "Equipment Allocation": Audit.extend({ entityType: z.literal("Equipment Allocation"), canonicalId: Id, equipmentAssetId: Id, oplocId: Id, operationalAreaId: Id.optional(), lifecycleState: z.enum(["active", "archived"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), operationalNotes: z.string().max(2000).optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Operational Team": Audit.extend({ entityType: z.literal("Operational Team"), canonicalId: Id, teamName: z.string().min(1).max(160), description: z.string().max(1000).optional(), lifecycleState: z.enum(["active", "archived"]), ownership: OwnedFields }).strict(),
  "Team Membership": Audit.extend({ entityType: z.literal("Team Membership"), canonicalId: Id, legendId: Id, teamId: Id, lifecycleState: z.enum(["active", "archived"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), notes: z.string().max(1000).optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Event Role": Audit.extend({ entityType: z.literal("Event Role"), canonicalId: Id, roleName: z.string().min(1).max(160), description: z.string().max(1000).optional(), lifecycleState: z.enum(["active", "retired"]), ownership: OwnedFields }).strict(),
  "Event Staffing Preference": Audit.extend({ entityType: z.literal("Event Staffing Preference"), canonicalId: Id, legendId: Id, eventRoleId: Id, eligibility: z.enum(["primary", "secondary", "fallback"]), suggestionRank: z.number().int().positive(), lifecycleState: z.enum(["active", "archived"]), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), notes: z.string().max(1000).optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Hospitality Menu Item": Audit.extend({ entityType: z.literal("Hospitality Menu Item"), canonicalId: Id, name: z.string().min(1).max(240), description: z.string().max(4000).optional(), category: z.string().min(1).max(160), lifecycleState: z.enum(["active", "archived"]), dietaryInformation: z.array(z.string().min(1).max(160)), allergenInformation: z.array(z.string().min(1).max(160)), providerMappings: z.array(z.object({ provider: z.string().min(1).max(160), sourceItemId: z.string().min(1).max(240), sourceVersion: z.string().max(240).optional() }).strict()), ownership: OwnedFields }).strict(),
  "Hospitality Menu Offering": Audit.extend({ entityType: z.literal("Hospitality Menu Offering"), canonicalId: Id, hospitalityMenuItemId: Id, oplocId: Id, operationalAreaId: Id.optional(), offeringMode: z.enum(["standard", "quote_only"]), lifecycleState: z.enum(["active", "archived"]), minimumQuantity: z.number().int().positive().optional(), minimumGuests: z.number().int().positive().optional(), noticeRequiredDays: z.number().int().nonnegative().optional(), configuration: z.object({ servingInfo: z.string().max(400).optional(), serves: z.number().positive().nullable().optional(), suggestionType: z.string().max(80).nullable().optional(), suggestionLabel: z.string().max(240).optional(), suggestionUnit: z.string().max(80).optional(), sortOrder: z.number().int().nonnegative().optional(), choices: z.array(z.object({ id: z.string().min(1).max(160), label: z.string().min(1).max(240), controlType: z.enum(["select", "multi"]), required: z.boolean(), options: z.array(z.object({ id: z.string().min(1).max(240), label: z.string().min(1).max(240) }).strict()).min(1) }).strict()).optional() }).strict().optional(), ownership: OwnedFields }).strict(),
  "Hospitality Menu Price": Audit.extend({ entityType: z.literal("Hospitality Menu Price"), canonicalId: Id, hospitalityMenuOfferingId: Id, amount: z.number().nonnegative(), currency: z.literal("GBP"), vatRate: z.number().min(0).max(1), effectiveFrom: z.string().date(), effectiveTo: z.string().date().optional(), lifecycleState: z.enum(["active", "archived"]), ownership: OwnedFields }).strict(),
  "Hospitality Brochure Import": Audit.extend({ entityType: z.literal("Hospitality Brochure Import"), canonicalId: Id, sourceFilename: z.string().min(1), sourceHash: z.string().min(1), sourceReference: z.string().min(1), extractionStatus: z.enum(["extracted", "needs-attention"]), lifecycleState: z.enum(["active", "archived"]), ownership: OwnedFields }).strict(),
  "Hospitality Brochure Candidate": Audit.extend({ entityType: z.literal("Hospitality Brochure Candidate"), canonicalId: Id, brochureImportId: Id, slideNumber: z.number().int().positive(), sourceText: z.string().min(1), proposedName: z.string().max(240).optional(), proposedCategory: z.string().max(160).optional(), proposedItemId: Id.optional(), proposedOfferingId: Id.optional(), oplocId: Id.optional(), operationalAreaId: Id.optional(), offeringMode: z.enum(["standard", "quote_only"]).optional(), priceSignal: z.string().max(160).optional(), reviewState: z.enum(["draft", "reviewed", "ignored"]), ignoreReason: z.string().max(1000).optional(), reviewedBy: Id.optional(), reviewedAt: Timestamp.optional(), publishedRecordIds: z.array(Id).optional(), ownership: OwnedFields }).strict(),
  OPLOC: Audit.extend({ entityType: z.literal("OPLOC"), canonicalId: Id, approvedName: z.string().min(1), primaryLocationType: LocationTypeName, locationTypeHistory: z.array(LocationTypeAssignment).min(1), lifecycleState: z.enum(["active", "decommissioned", "merged"]), mergedIntoOplocId: Id.optional(), addressReference: Id.optional(), aliases: z.array(z.object({ alias: z.string().min(1), sourceReference: z.string().optional(), recordedAt: Timestamp }).strict()), ownership: OwnedFields }).strict().superRefine((value, context) => {
    const current = value.locationTypeHistory.filter(assignment => !assignment.effectiveTo);
    if (current.length !== 1 || current[0]?.locationType !== value.primaryLocationType) context.addIssue({ code: "custom", path: ["locationTypeHistory"], message: "Exactly one current Location Type assignment must match primaryLocationType." });
    if (value.lifecycleState === "merged" && !value.mergedIntoOplocId) context.addIssue({ code: "custom", path: ["mergedIntoOplocId"], message: "A merged OPLOC must reference its surviving OPLOC." });
    if (value.mergedIntoOplocId === value.canonicalId) context.addIssue({ code: "custom", path: ["mergedIntoOplocId"], message: "An OPLOC cannot merge into itself." });
  }),
  Address: Audit.extend({ entityType: z.literal("Address"), canonicalId: Id, addressId: Id, addressLine1: z.string().trim().min(1).max(240), addressLine2: z.string().trim().min(1).max(240).optional(), addressLine3: z.string().trim().min(1).max(240).optional(), locality: z.string().trim().min(1).max(160), region: z.string().trim().min(1).max(160).optional(), postalCode: z.string().trim().min(1).max(40).optional(), countryCode: z.enum(CountryCodes as [string, ...string[]]), lifecycleState: z.enum(["active", "retired"]), approvalState: z.enum(["pending", "approved"]), evidenceReferences: z.array(Id), decisionReason: z.string().min(10).max(1000), approvedBy: Id.optional(), approvedAt: Timestamp.optional(), ownership: OwnedFields }).strict().superRefine((value, context) => {
    if (value.addressId !== value.canonicalId) context.addIssue({ code: "custom", path: ["addressId"], message: "addressId must equal the immutable canonical Address ID." });
    if (value.countryCode === "GB" && (!value.postalCode || !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{5,8}$/.test(normalisePostalCode(value.postalCode)))) context.addIssue({ code: "custom", path: ["postalCode"], message: "A recognisable UK postcode is required for a GB Address." });
    if (value.approvalState === "approved" && (!value.approvedBy || !value.approvedAt)) context.addIssue({ code: "custom", path: ["approvalState"], message: "An approved Address requires approver and approval timestamp." });
    if (value.approvalState === "pending" && (value.approvedBy || value.approvedAt)) context.addIssue({ code: "custom", path: ["approvalState"], message: "A pending Address cannot retain stale approval metadata." });
  }),
  "Staffing Role": Audit.extend({ entityType: z.literal("Staffing Role"), canonicalId: Id, name: z.string().min(1).max(160), description: z.string().max(1000).optional(), ownership: OwnedFields }).strict(),
  "Site Staffing Requirement": Audit.extend({ entityType: z.literal("Site Staffing Requirement"), canonicalId: Id, oplocId: Id, staffingRoleId: Id, requiredHeadcount: z.number().int().positive(), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), notes: z.string().max(1000).optional(), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Site Role Assignment": Audit.extend({ entityType: z.literal("Site Role Assignment"), canonicalId: Id, legendId: Id, oplocId: Id, staffingRoleId: Id, effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), primaryLocation: z.boolean(), lifecycleState: z.enum(["active", "ended"]), ownership: OwnedFields }).strict().superRefine((value, context) => { if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to cannot be before effective-from." }); }),
  "Production Unit": Audit.extend({ entityType: z.literal("Production Unit"), canonicalId: Id, name: z.string().min(1), operationalLocationId: Id, ownership: OwnedFields }).strict(),
  "Till Item": Audit.extend({ entityType: z.literal("Till Item"), canonicalId: Id, name: z.string().min(1), categoryId: Id.optional(), ownership: OwnedFields }).strict(),
  "Till Item Variation": Audit.extend({ entityType: z.literal("Till Item Variation"), canonicalId: Id, tillItemId: Id, name: z.string().min(1), sku: z.string().optional(), sitePrices: z.array(z.object({ siteId: Id, amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) }).strict()), ownership: OwnedFields }).strict(),
  "Product Category": Audit.extend({ entityType: z.literal("Product Category"), canonicalId: Id, name: z.string().min(1), ownership: OwnedFields }).strict(),
} as const;

export type CanonicalEntityType = keyof typeof CanonicalSchemas;
export const CanonicalEntityNames = Object.keys(CanonicalSchemas) as CanonicalEntityType[];
export const AcceptedCanonicalEntityTypes = ["OPLOC", "Address", "Legend", "Operational Assignment", "Operational Capability", "Capability Enablement"] as const satisfies readonly CanonicalEntityType[];
export const LocationTypeNames = LocationTypeName.options;

export const ExternalIdentitySchema = ExternalIdentity.extend({ canonicalId: Id }).strict();
export const ProvenanceRecordSchema = z.object({ provenanceId: Id, sourceImportId: Id, provider: z.string(), sourceReference: z.string(), sourceHash: z.string(), worksheet: z.string().optional(), sourceRow: z.number().int().positive().optional(), capturedAt: Timestamp, actorId: Id }).strict();
export const ValidationIssueSchema = z.object({ issueId: Id, severity: z.enum(["blocking", "warning", "information"]), code: z.string(), field: z.string().optional(), message: z.string() }).strict();
export const MappingDefinitionSchema = z.object({ mappingId: Id, version: z.number().int().positive(), name: z.string(), sourceKind: z.string(), targetEntity: z.string(), fields: z.array(z.object({ source: z.string(), target: z.string().nullable(), transform: z.enum(["none", "trim", "lowercase", "number", "date"]), constant: z.string().optional(), externalIdentifier: z.boolean(), confidence: z.number().min(0).max(1) }).strict()), createdAt: Timestamp, createdBy: Id }).strict();
export const SourceImportSchema = z.object({ importId: Id, sourceKind: z.enum(["spreadsheet", "brochure-presentation", "brighthr", "square"]), originalFilename: z.string().optional(), fileHash: z.string(), workbook: z.string().optional(), worksheet: z.string().optional(), uploadedAt: Timestamp, importedBy: Id, status: z.enum(["profiled", "staged", "completed", "partial", "failed"]), mappingId: Id.optional(), mappingVersion: z.number().int().positive().optional(), rawSnapshotReference: z.string().optional(), extractionSnapshotReference: z.string().optional() }).strict();
export const SyncProgressSchema = z.object({ phase: z.string(), message: z.string(), completed: z.number().int().nonnegative().optional(), total: z.number().int().positive().optional(), percent: z.number().min(0).max(100).optional(), updatedAt: Timestamp }).strict();
export const SyncRunSchema = z.object({ syncRunId: Id, provider: z.enum(["brighthr", "square"]), mode: z.enum(["fixture", "live-local"]), startedAt: Timestamp, finishedAt: Timestamp.optional(), status: z.enum(["running", "succeeded", "partial", "failed"]), counts: z.record(z.string(), z.number().int().nonnegative()), correlationId: Id, message: z.string().optional(), progress: SyncProgressSchema.optional(), sourceSnapshotReference: z.string().optional(), sourceSnapshotHash: z.string().optional() }).strict();

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type MappingDefinition = z.infer<typeof MappingDefinitionSchema>;
export type SourceImport = z.infer<typeof SourceImportSchema>;
export type SyncRun = z.infer<typeof SyncRunSchema>;
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

export type StagingRecord = {
  stagingId: string;
  importId: string;
  sourceRow: number;
  entityType: CanonicalEntityType | "Unknown Dataset";
  raw: Record<string, unknown>;
  normalised: Record<string, unknown>;
  issues: ValidationIssue[];
  duplicateCandidates: { canonicalId: string; reason: string; confidence: number }[];
  state: "ready" | "invalid" | "possible-duplicate" | "conflict" | "excluded" | "unresolved" | "approved";
  exclusionReason?: string;
  mappingVersion: number;
  reviewedBy?: string;
  reviewedAt?: string;
};

export function parseCanonical(type: CanonicalEntityType, value: unknown) {
  return CanonicalSchemas[type].safeParse(value);
}
