import type { CanonicalEntityType } from "./schemas";

export type CatalogueField = {
  name: string;
  label: string;
  valueType: "string" | "email" | "boolean" | "date" | "money-list" | "owned-fields" | "external-identities" | "provenance";
  required: boolean;
  editable: boolean;
  description: string;
  sensitive?: boolean;
  values?: string[];
};

export type CatalogueSchema = {
  schemaId: string;
  entityType: CanonicalEntityType;
  title: string;
  version: "0.1.0";
  lifecycle: "development";
  description: string;
  sourceOfTruth: string;
  validator: string;
  authorityRules: string[];
  sensitiveFieldPolicy: string;
  relationships: { field: string; target: string }[];
  lifecycleSupport: ("draft" | "needs-review" | "published" | "archived")[];
  versionHistory: { version: string; status: "development"; note: string }[];
  definitionStatus: "accepted-canon" | "future-candidate" | "development-only" | "legacy-source-candidate" | "deferred";
  relatedDecisions: string[];
  fields: CatalogueField[];
};

const commonFields: CatalogueField[] = [
  { name: "canonicalId", label: "Canonical ID", valueType: "string", required: true, editable: false, description: "Stable FIKA identity. Provider identifiers never replace it." },
  { name: "schemaVersion", label: "Schema version", valueType: "string", required: true, editable: false, description: "Version of the deliberate canonical contract." },
  { name: "version", label: "Record version", valueType: "string", required: true, editable: false, description: "Optimistic-concurrency version incremented by governed changes." },
  { name: "active", label: "Active", valueType: "boolean", required: true, editable: true, description: "Whether the canonical record remains active." },
  { name: "externalIdentities", label: "External identities", valueType: "external-identities", required: true, editable: false, description: "Provider references linked to, but distinct from, canonical identity." },
  { name: "provenanceIds", label: "Provenance references", valueType: "provenance", required: true, editable: false, description: "References to evidence supporting the canonical record." },
  { name: "ownership", label: "Field ownership", valueType: "owned-fields", required: true, editable: false, description: "Separation between provider-owned facts and FIKA-owned enrichment." },
];

const definitionStatus: Partial<Record<CanonicalEntityType, CatalogueSchema["definitionStatus"]>> = {
  OPLOC: "accepted-canon", Address: "accepted-canon", Legend: "accepted-canon", "Operational Assignment": "accepted-canon", "Operational Capability": "accepted-canon", "Capability Enablement": "accepted-canon", "Operational Area Type": "development-only", "Operational Area": "development-only", "Service Definition": "development-only", "Service Arrangement": "development-only", "Equipment Type": "development-only", "Equipment Asset": "development-only", "Equipment Allocation": "development-only", "Operational Team": "development-only", "Team Membership": "development-only", "Event Role": "development-only", "Event Staffing Preference": "development-only", "Hospitality Menu Item": "development-only", "Hospitality Menu Offering": "development-only", "Hospitality Menu Price": "development-only", "Hospitality Brochure Import": "development-only", "Hospitality Brochure Candidate": "development-only", Site: "legacy-source-candidate", Employment: "development-only", Absence: "development-only", "Site Assignment": "development-only", "Source Mapping": "development-only", "Operational Placement Evidence": "development-only", "Staffing Role": "development-only", "Site Staffing Requirement": "development-only", "Site Role Assignment": "development-only", "Production Unit": "development-only", "Product Category": "development-only", "Till Item": "deferred", "Till Item Variation": "deferred",
};
const decisions: Partial<Record<CanonicalEntityType, string[]>> = { OPLOC: ["LOC-001", "LOC-002", "LOC-003", "LOC-004", "LOC-006", "TYPE-001", "TYPE-002", "TYPE-003", "ADDR-001"], Address: ["ADDR-001", "LOC-003", "LOC-006", "ROLE-003", "ROLE-005"], Legend: ["Owner decision 2026-07-28; governed BDR identifier pending"], "Operational Assignment": ["Owner decision 2026-07-28; governed BDR identifier pending"], "Operational Capability": ["CAP-001", "CAP-004"], "Capability Enablement": ["CAP-001", "CAP-002", "CAP-003", "CAP-004"] };

function schema(entityType: CanonicalEntityType, title: string, description: string, fields: CatalogueField[]): CatalogueSchema {
  const relationships = fields.filter(field => (/Id$/.test(field.name) && !["canonicalId", "addressId", "sourceIdentifier"].includes(field.name)) || field.name === "addressReference").map(field => ({ field: field.name, target: field.name === "addressReference" ? "Address" : field.name.replace(/Id$/, "") }));
  const status = definitionStatus[entityType] || "development-only";
  return { schemaId: `schema:${entityType.toLowerCase().replaceAll(" ", "-")}:0.1.0`, entityType, title, version: "0.1.0", lifecycle: "development", definitionStatus: status, relatedDecisions: decisions[entityType] || [], description, sourceOfTruth: status === "accepted-canon" ? "Published canonical record after governed review and publication" : "Candidate or compatibility record excluded from accepted downstream publication", validator: `CanonicalSchemas[${JSON.stringify(entityType)}]`, authorityRules: ["Provider facts and FIKA-reviewed decisions remain distinguishable.", entityType === "Address" ? "An authorised Address save automatically approves and publishes a valid complete record." : "Only an Integration Administrator may publish accepted entity types."], sensitiveFieldPolicy: fields.some(field => field.sensitive) ? "Sensitive fields are centrally redacted by role; restricted HR details are excluded from ordinary records." : "No restricted fields are defined; source evidence remains administrator-only.", relationships, lifecycleSupport: ["draft", "needs-review", "published", "archived"], versionHistory: [{ version: "0.1.0", status: "development", note: "Initial deliberate Integration Hub contract; not inferred from provider records." }], fields: [...commonFields, ...fields] };
}

export const SchemaCatalogue: CatalogueSchema[] = [
  schema("Legend", "Legend", "Accepted durable human identity recognised by FIKA OS. Existing provider-derived candidates remain unpublished and require record-level review.", [
    { name: "displayName", label: "Display name", valueType: "string", required: true, editable: true, description: "Human-readable Legend name." },
    { name: "preferredName", label: "Preferred name", valueType: "string", required: false, editable: true, description: "Reviewed preferred operational name where approved." },
    { name: "workEmail", label: "Work email", valueType: "email", required: false, editable: true, sensitive: true, description: "Work contact email where supplied." },
    { name: "jobTitle", label: "Legacy job title evidence", valueType: "string", required: false, editable: false, sensitive: true, description: "Compatibility-only provider field retained on existing candidates; it belongs in Employment and blocks publication as a core Legend field." },
    { name: "employmentState", label: "Legacy employment-state evidence", valueType: "string", required: false, editable: false, sensitive: true, description: "Compatibility-only provider field retained on existing candidates; it belongs in Employment and blocks publication as a core Legend field." },
  ]),
  schema("Employment", "Employment", "Employment facts linked to a durable Legend identity; missing dates remain missing.", [
    { name: "legendId", label: "Legend ID", valueType: "string", required: true, editable: false, description: "Stable Legend relationship." },
    { name: "employmentState", label: "Employment state", valueType: "string", required: true, editable: true, description: "Provider-authoritative employment state where available." },
    { name: "startDate", label: "Start date", valueType: "date", required: false, editable: true, description: "Employment start date; never inferred." },
    { name: "terminationDate", label: "Termination date", valueType: "date", required: false, editable: true, description: "Provider-supplied termination date." },
    { name: "contractualJobTitle", label: "Contractual job title", valueType: "string", required: false, editable: true, description: "Contractual role title where supplied." },
    { name: "contractHours", label: "Contract hours", valueType: "string", required: false, editable: true, description: "Contract hours where supplied by an authoritative source." },
  ]),
  schema("Absence", "Absence", "Approved or observed absence linked to a canonical Legend.", [
    { name: "legendId", label: "Legend ID", valueType: "string", required: true, editable: true, description: "Canonical Legend relationship." },
    { name: "startDate", label: "Start date", valueType: "date", required: true, editable: true, description: "First date of absence." },
    { name: "endDate", label: "End date", valueType: "date", required: true, editable: true, description: "Last date of absence." },
    { name: "absenceType", label: "Absence type", valueType: "string", required: false, editable: true, description: "Provider-reported absence classification." },
    { name: "approvalState", label: "Approval state", valueType: "string", required: false, editable: true, description: "Provider-reported approval state." },
  ]),
  schema("Site", "Source Site candidate", "Current provider-derived Site candidate retained for review. Publication is blocked until its meaning is reconciled with the canonical OPLOC model.", [
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Human-readable Site name." },
    { name: "operationalLocationId", label: "OPLOC ID", valueType: "string", required: false, editable: true, description: "Canonical Operational Location relationship where governed." },
    { name: "address", label: "Address", valueType: "string", required: false, editable: true, description: "Operational address where supplied." },
  ]),
  schema("Site Assignment", "Site Assignment (development proposal)", "Unaccepted assignment proposal retained for discovery; it references OPLOC only and must not be published.", [
    { name: "legendId", label: "Legend ID", valueType: "string", required: true, editable: false, description: "Assigned Legend." },
    { name: "oplocId", label: "OPLOC ID", valueType: "string", required: true, editable: false, description: "Stable OPLOC relationship; Site is a classification, not another identity." },
    { name: "assignmentType", label: "Assignment type", valueType: "string", required: true, editable: true, description: "Business classification of the assignment." },
    { name: "designation", label: "Designation", valueType: "string", required: true, editable: true, values: ["primary", "secondary"], description: "Primary or secondary designation." },
    { name: "assignmentStatus", label: "Assignment status", valueType: "string", required: true, editable: true, values: ["proposed", "confirmed", "ended"], description: "Review state of the assignment." },
  ]),
  schema("Source Mapping", "Source Mapping", "Durable reviewed mapping from provider evidence to a canonical identity.", [
    { name: "sourceProvider", label: "Source provider", valueType: "string", required: true, editable: false, description: "Provider or evidence source." },
    { name: "sourceEntityType", label: "Source entity type", valueType: "string", required: true, editable: false, description: "Provider-side identity type." },
    { name: "sourceIdentifier", label: "Source identifier", valueType: "string", required: true, editable: false, description: "Stable source identifier or reviewed label key." },
    { name: "targetCanonicalId", label: "Target canonical ID", valueType: "string", required: false, editable: false, description: "Reviewed non-location canonical target where applicable." },
    { name: "oplocId", label: "OPLOC ID", valueType: "string", required: false, editable: false, description: "Required target for a confirmed location mapping." },
    { name: "mappingStatus", label: "Mapping status", valueType: "string", required: true, editable: false, values: ["unresolved", "confirmed", "rejected", "deferred", "historical", "irrelevant"], description: "Explicit decision status." },
  ]),
  schema("Operational Placement Evidence", "Operational Placement Evidence", "Rota-derived placement evidence that is not a confirmed Site Assignment.", [
    { name: "sourceIdentity", label: "Source identity", valueType: "string", required: true, editable: false, description: "Rota identity key retained as evidence." },
    { name: "sourceLocationLabel", label: "Source location label", valueType: "string", required: true, editable: false, description: "Original source label, never overwritten by a canonical name." },
    { name: "oplocId", label: "OPLOC ID", valueType: "string", required: false, editable: false, description: "Reviewed OPLOC mapping; absence means unresolved evidence." },
    { name: "evidencePeriod", label: "Evidence period", valueType: "string", required: true, editable: false, values: ["historical", "current", "future-scheduled", "unresolved"], description: "Prevents scheduled evidence being presented as completed work." },
    { name: "sourceReference", label: "Source reference", valueType: "string", required: true, editable: false, description: "Immutable evidence reference." },
    { name: "reviewStatus", label: "Review status", valueType: "string", required: true, editable: false, values: ["unresolved", "confirmed", "rejected"], description: "Human review state." },
  ]),
  schema("Operational Assignment", "Operational Assignment", "Accepted effective-dated, human-approved ongoing operational relationship between one Legend and one OPLOC. It is not Employment or a rota shift.", [
    { name: "legendId", label: "Legend", valueType: "string", required: true, editable: false, description: "Stable reviewed Legend identity." },
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Stable reviewed Operational Location identity." },
    { name: "assignmentRole", label: "Assignment role", valueType: "string", required: true, editable: true, description: "Open governed business wording; no closed role catalogue has been adopted." },
    { name: "designation", label: "Designation", valueType: "string", required: true, editable: true, values: ["primary", "secondary"], description: "Governed primary or secondary status." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." },
    { name: "effectiveTo", label: "Effective to", valueType: "date", required: false, editable: true, description: "Optional final effective date." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "ended", "archived"], description: "Assignment lifecycle independent of publication." },
    { name: "decisionReason", label: "Decision reason", valueType: "string", required: true, editable: false, description: "Authenticated human decision provenance." },
  ]),
  schema("Operational Capability", "Operational Capability", "Accepted reusable business ability governed through the organisation-wide catalogue. This definition does not enable the capability at an OPLOC.", [
    { name: "capabilityName", label: "Capability name", valueType: "string", required: true, editable: true, description: "Reviewed business name from the governed catalogue." },
    { name: "owningDomainId", label: "Owning domain ID", valueType: "string", required: true, editable: true, description: "Stable reference to the domain that owns the capability's meaning and lifecycle." },
    { name: "businessPurpose", label: "Business purpose", valueType: "string", required: true, editable: true, description: "Why the reusable business ability exists." },
    { name: "eligibilitySummary", label: "Eligibility summary", valueType: "string", required: false, editable: true, description: "Approved summary only; detailed enablement policy remains separately governed." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Catalogue-entry lifecycle." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." },
    { name: "effectiveTo", label: "Effective to", valueType: "date", required: false, editable: true, description: "Optional final effective date." },
    { name: "decisionReason", label: "Decision reason", valueType: "string", required: true, editable: false, description: "Authenticated human decision provenance." },
  ]),
  schema("Capability Enablement", "Capability Enablement", "Accepted effective-dated relationship recording whether an approved Operational Capability is available at an OPLOC. It neither changes Location Type nor grants permission.", [
    { name: "capabilityId", label: "Operational Capability", valueType: "string", required: true, editable: false, description: "Stable accepted capability identity." },
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Stable Operational Location identity." },
    { name: "state", label: "Enablement state", valueType: "string", required: true, editable: true, values: ["enabled", "disabled", "unavailable", "ineligible"], description: "Governed availability state from the accepted Pack 2 decision." },
    { name: "businessOwnerRoleId", label: "Business owner role ID", valueType: "string", required: true, editable: true, description: "Role accountable for this operating scope; not a named person." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." },
    { name: "effectiveTo", label: "Effective to", valueType: "date", required: false, editable: true, description: "Optional final effective date." },
    { name: "configurationReferenceId", label: "Configuration reference ID", valueType: "string", required: false, editable: true, description: "Optional governed configuration reference; it does not define business meaning." },
    { name: "decisionReason", label: "Decision reason", valueType: "string", required: true, editable: false, description: "Authenticated human decision provenance." },
  ]),
  schema("Operational Area Type", "Operational Area Type", "Controlled development catalogue for subordinate Operational Area classifications. It is not a Location Type, OPLOC or staffing role.", [
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Controlled human-readable area classification." },
    { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional explanation of the operating context." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Catalogue-entry lifecycle." },
  ]),
  schema("Operational Area", "Operational Area", "Subordinate configurable operating context within one OPLOC. It is not a Site, Venue, OPLOC or staffing entity.", [
    { name: "areaId", label: "Operational Area ID", valueType: "string", required: true, editable: false, description: "Stable identity equal to canonical ID." },
    { name: "oplocId", label: "Owning OPLOC", valueType: "string", required: true, editable: false, description: "The sole durable location identity that owns this area." },
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Human-readable service-point context." },
    { name: "areaTypeId", label: "Area type", valueType: "string", required: true, editable: true, description: "Reference to the controlled Operational Area Type catalogue." },
    { name: "floorLevel", label: "Floor or level", valueType: "string", required: true, editable: true, description: "Integer floor/level retained for reporting and operations." },
    { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional operational description." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "archived"], description: "Archive preserves identity and provider mapping history." },
  ]),
  schema("Service Definition", "Service Definition", "Development-only controlled reusable service type. It does not represent a booking, event or transaction.", [
    { name: "serviceName", label: "Service name", valueType: "string", required: true, editable: true, description: "Controlled reusable operational service name." },
    { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional operational purpose." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Catalogue-entry lifecycle." },
  ]),
  schema("Service Arrangement", "Service Arrangement", "Development-only effective-dated enabled instance of one Service Definition at an OPLOC or one of its Operational Areas.", [
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Owning canonical Operational Location." },
    { name: "operationalAreaId", label: "Operational Area", valueType: "string", required: false, editable: false, description: "Optional subordinate operating context belonging to the OPLOC." },
    { name: "serviceDefinitionId", label: "Service definition", valueType: "string", required: true, editable: false, description: "Controlled reusable Service Definition reference." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First operational date." },
    { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional final operational date." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "archived"], description: "Archive preserves the arrangement history." },
  ]),
  schema("Equipment Type", "Equipment Type", "Development-only controlled catalogue for durable Equipment Assets.", [
    { name: "name", label: "Equipment type", valueType: "string", required: true, editable: true, description: "Controlled human-readable equipment classification." },
    { name: "category", label: "Category", valueType: "string", required: false, editable: true, description: "Optional controlled catalogue grouping." },
    { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional human-readable catalogue description." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Catalogue-entry lifecycle." },
  ]),
  schema("Equipment Asset", "Equipment Asset", "Development-only durable physical asset identity. Allocation is recorded separately so moves preserve history.", [
    { name: "assetName", label: "Asset name", valueType: "string", required: true, editable: true, description: "Human-readable equipment asset name." },
    { name: "equipmentTypeId", label: "Equipment type", valueType: "string", required: true, editable: false, description: "Controlled Equipment Type reference." },
    { name: "serialNumber", label: "Serial number", valueType: "string", required: false, editable: true, description: "Optional manufacturer serial reference." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Asset lifecycle independent from allocations." },
  ]),
  schema("Equipment Allocation", "Equipment Allocation", "Development-only effective-dated deployment of a durable Equipment Asset at an OPLOC or one of its Operational Areas.", [
    { name: "equipmentAssetId", label: "Equipment asset", valueType: "string", required: true, editable: false, description: "Durable Equipment Asset identity." },
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Operational Location where the asset is deployed." },
    { name: "operationalAreaId", label: "Operational Area", valueType: "string", required: false, editable: false, description: "Optional operational area belonging to the OPLOC." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First deployment date." },
    { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional final deployment date." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "archived"], description: "Archive preserves allocation history." },
  ]),
  schema("OPLOC", "Operational Location", "Stable Operational Location identity.", [
    { name: "approvedName", label: "Approved name", valueType: "string", required: true, editable: true, description: "Approved human-readable Operational Location name." },
    { name: "primaryLocationType", label: "Primary Location Type", valueType: "string", required: true, editable: false, values: ["Site", "Venue"], description: "Current governed classification. Operational functions are not Location Types." },
    { name: "locationTypeHistory", label: "Location Type history", valueType: "owned-fields", required: true, editable: false, description: "Effective-dated approved classification history; exactly one assignment remains current." },
    { name: "lifecycleState", label: "Lifecycle state", valueType: "string", required: true, editable: true, values: ["active", "decommissioned", "merged"], description: "Governed Operational Location lifecycle state." },
    { name: "addressReference", label: "Address reference", valueType: "string", required: false, editable: true, description: "Optional stable canonical Address ID. It never contains formatted address text." },
    { name: "aliases", label: "Aliases", valueType: "owned-fields", required: true, editable: false, description: "Historical names retained without replacing canonical identity." },
  ]),
  schema("Address", "Address", "Accepted reusable structured address master data. A valid Address supplied by an authorised user is approved and published automatically.", [
    { name: "addressId", label: "Address ID", valueType: "string", required: true, editable: false, description: "Immutable stable Address identity; equal to the canonical ID." },
    { name: "addressLine1", label: "Address line 1", valueType: "string", required: true, editable: true, description: "Primary premises or street line." },
    { name: "addressLine2", label: "Address line 2", valueType: "string", required: false, editable: true, description: "Optional building, floor, suite, premises or street detail." },
    { name: "addressLine3", label: "Address line 3", valueType: "string", required: false, editable: true, description: "Optional additional premises detail where needed." },
    { name: "locality", label: "Town or city", valueType: "string", required: true, editable: true, description: "Town, city or equivalent locality." },
    { name: "region", label: "County, state or region", valueType: "string", required: false, editable: true, description: "Optional regional subdivision." },
    { name: "postalCode", label: "Postcode or postal code", valueType: "string", required: false, editable: true, description: "Postal code where the country uses one; required for GB addresses." },
    { name: "countryCode", label: "Country", valueType: "string", required: true, editable: true, description: "Governed ISO 3166-1 alpha-2 country code." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Address lifecycle independent of record review and publication." },
    { name: "approvalState", label: "Approval state", valueType: "string", required: true, editable: false, values: ["pending", "approved"], description: "Records whether a valid Address completed automatic approval and publication. Pending remains for incomplete or legacy records awaiting review." },
    { name: "evidenceReferences", label: "Evidence references", valueType: "provenance", required: true, editable: false, description: "Stable references to preserved evidence; provider payloads are not copied into canonical fields." },
    { name: "decisionReason", label: "Decision reason", valueType: "string", required: true, editable: false, description: "Authenticated human decision provenance." },
  ]),
  schema("Staffing Role", "Staffing Role", "Development-only reusable operational staffing-role reference.", [
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Human-readable operational staffing role name." },
    { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional explanation of the operational role." },
  ]),
  schema("Site Staffing Requirement", "Site Staffing Requirement", "Development-only effective-dated required headcount for one Staffing Role at one OPLOC.", [
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Operational Location whose staffing structure is described." },
    { name: "staffingRoleId", label: "Staffing Role", valueType: "string", required: true, editable: false, description: "Reusable development Staffing Role reference." },
    { name: "requiredHeadcount", label: "Required headcount", valueType: "string", required: true, editable: true, description: "Positive whole-number headcount requirement." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." },
    { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional last effective date." },
    { name: "notes", label: "Notes", valueType: "string", required: false, editable: true, description: "Optional operational context." },
  ]),
  schema("Site Role Assignment", "Site Role Assignment", "Development-only effective-dated relationship recording which Legend fills a Staffing Role at an OPLOC.", [
    { name: "legendId", label: "Legend", valueType: "string", required: true, editable: false, description: "Durable Legend identity." },
    { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Operational Location where the role is performed." },
    { name: "staffingRoleId", label: "Staffing Role", valueType: "string", required: true, editable: false, description: "Reusable development Staffing Role reference." },
    { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." },
    { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional last effective date." },
    { name: "primaryLocation", label: "Primary location", valueType: "boolean", required: true, editable: true, description: "Whether this is the Legend's active primary working location." },
    { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "ended"], description: "Development assignment lifecycle." },
  ]),
  schema("Operational Team", "Operational Team", "Development-only controlled operational team reference. Team membership never implies suitability, authority or permission.", [{ name: "teamName", label: "Team name", valueType: "string", required: true, editable: true, description: "Controlled operational team name." }, { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional team context." }, { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "archived"], description: "Controlled catalogue lifecycle." }]),
  schema("Team Membership", "Team Membership", "Development-only effective-dated Legend membership of an Operational Team; it does not grant AUTHMOD permissions or create rota data.", [{ name: "legendId", label: "Legend", valueType: "string", required: true, editable: false, description: "Durable Legend identity." }, { name: "teamId", label: "Operational Team", valueType: "string", required: true, editable: false, description: "Controlled team reference." }, { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." }, { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional last effective date." }, { name: "notes", label: "Notes", valueType: "string", required: false, editable: true, description: "Optional operational context." }]),
  schema("Event Role", "Event Role", "Development-only controlled catalogue of roles used to express explicit Event staffing eligibility.", [{ name: "roleName", label: "Event Role name", valueType: "string", required: true, editable: true, description: "Controlled Event Role name." }, { name: "description", label: "Description", valueType: "string", required: false, editable: true, description: "Optional Event Role context." }, { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "retired"], description: "Controlled catalogue lifecycle." }]),
  schema("Event Staffing Preference", "Event Staffing Preference", "Development-only explicit effective-dated Event Role eligibility and suggestion rank. It is not an availability claim, rota shift, permanent staffing assignment or permission.", [{ name: "legendId", label: "Legend", valueType: "string", required: true, editable: false, description: "Durable Legend identity." }, { name: "eventRoleId", label: "Event Role", valueType: "string", required: true, editable: false, description: "Controlled Event Role reference." }, { name: "eligibility", label: "Eligibility", valueType: "string", required: true, editable: true, values: ["primary", "secondary", "fallback"], description: "Explicit suggestion tier." }, { name: "suggestionRank", label: "Suggestion rank", valueType: "string", required: true, editable: true, description: "Positive rank within the eligibility tier." }, { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "First effective date." }, { name: "effectiveTo", label: "Effective until", valueType: "date", required: false, editable: true, description: "Optional last effective date." }, { name: "notes", label: "Notes", valueType: "string", required: false, editable: true, description: "Optional rationale or context." }]),
  schema("Hospitality Menu Item", "Hospitality Menu Item", "Reusable governed hospitality definition. Standard price belongs to a scoped Hospitality Menu Offering Price, not this reusable Item.", [{ name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Customer-facing menu or package name." }, { name: "category", label: "Category", valueType: "string", required: true, editable: true, description: "Hospitality catalogue grouping." }, { name: "dietaryInformation", label: "Dietary information", valueType: "owned-fields", required: true, editable: true, description: "Source-provided dietary information; never inferred from description." }, { name: "allergenInformation", label: "Allergen information", valueType: "owned-fields", required: true, editable: true, description: "Source-provided allergen information; never inferred from description." }, { name: "providerMappings", label: "Provider mappings", valueType: "external-identities", required: true, editable: true, description: "Explicit reviewed source identifiers." }, { name: "lifecycleState", label: "Lifecycle", valueType: "string", required: true, editable: true, values: ["active", "archived"], description: "Archived items remain readable in historic commercial snapshots." }]),
  schema("Hospitality Menu Offering", "Hospitality Menu Offering", "Development-only OPLOC/Operational Area-scoped availability and ordering configuration. Quote-only Offerings never have a catalogue price.", [{ name: "hospitalityMenuItemId", label: "Menu Item", valueType: "string", required: true, editable: false, description: "Reusable Menu Item reference." }, { name: "oplocId", label: "OPLOC", valueType: "string", required: true, editable: false, description: "Governed delivery scope." }, { name: "operationalAreaId", label: "Operational Area", valueType: "string", required: false, editable: false, description: "Optional local scope; omitted means OPLOC-wide." }, { name: "offeringMode", label: "Offering mode", valueType: "string", required: true, editable: true, values: ["standard", "quote_only"], description: "Standard needs an effective price; quote-only requires enquiry." }, { name: "configuration", label: "Ordering configuration", valueType: "owned-fields", required: false, editable: true, description: "Reviewed choice groups and ordering presentation copied from source evidence." }]),
  schema("Hospitality Menu Price", "Hospitality Menu Price", "Development-only effective-dated standard price for one standard Offering. Bespoke quote-only work is priced only in the Booking or Quote snapshot.", [{ name: "hospitalityMenuOfferingId", label: "Offering", valueType: "string", required: true, editable: false, description: "Scoped standard Offering." }, { name: "amount", label: "Amount", valueType: "string", required: true, editable: true, description: "GBP standard price." }, { name: "effectiveFrom", label: "Effective from", valueType: "date", required: true, editable: true, description: "Explicitly governed price start date." }]),
  schema("Hospitality Brochure Import", "Hospitality Brochure Import", "Development-only retained source-file and extraction evidence. It is never published as menu data.", [{ name: "sourceFilename", label: "Source file", valueType: "string", required: true, editable: false, description: "Retained presentation evidence." }, { name: "extractionStatus", label: "Extraction status", valueType: "string", required: true, editable: false, description: "Local extraction outcome." }]),
  schema("Hospitality Brochure Candidate", "Hospitality Brochure Candidate", "Development-only row-level brochure evidence awaiting an explicit item, scope, mode and price decision; never automatic canonical truth.", [{ name: "brochureImportId", label: "Brochure import", valueType: "string", required: true, editable: false, description: "Source evidence parent." }, { name: "sourceText", label: "Source excerpt", valueType: "string", required: true, editable: false, description: "Verbatim extracted evidence." }, { name: "reviewState", label: "Review state", valueType: "string", required: true, editable: true, values: ["draft", "reviewed", "ignored"], description: "Explicit review outcome." }]),
  schema("Production Unit", "Production Unit", "Production unit associated with an Operational Location.", [
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Production unit name." },
    { name: "operationalLocationId", label: "OPLOC ID", valueType: "string", required: true, editable: true, description: "Canonical producing Operational Location." },
  ]),
  schema("Product Category", "Product Category", "Canonical category used to organise Till Items.", [{ name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Category name." }]),
  schema("Till Item", "Till Item", "Canonical item offered through a till provider.", [
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Till Item name." },
    { name: "categoryId", label: "Category ID", valueType: "string", required: false, editable: true, description: "Canonical Product Category relationship." },
  ]),
  schema("Till Item Variation", "Till Item Variation", "Priced or operational variation of a canonical Till Item.", [
    { name: "tillItemId", label: "Till Item ID", valueType: "string", required: true, editable: true, description: "Canonical parent Till Item relationship." },
    { name: "name", label: "Name", valueType: "string", required: true, editable: true, description: "Variation name." },
    { name: "sku", label: "SKU", valueType: "string", required: false, editable: true, description: "Provider or FIKA stock-keeping reference." },
    { name: "sitePrices", label: "Site prices", valueType: "money-list", required: true, editable: false, description: "Validated location-specific price snapshots." },
  ]),
];

export function schemaDefinition(entityType: CanonicalEntityType) {
  return SchemaCatalogue.find(definition => definition.entityType === entityType);
}
