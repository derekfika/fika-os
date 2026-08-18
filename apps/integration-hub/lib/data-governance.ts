import crypto from "node:crypto";
import type { CanonicalLifecycle, CanonicalRecord } from "./types";
import type { StagingRecord } from "./schemas";

export type CompletenessClassification = "mapped-now" | "retained-not-mapped" | "deliberately-excluded" | "restricted-sensitive" | "unavailable-from-provider" | "unknown-investigation";
export type CompletenessField = { fieldId: string; provider: string; providerEntity: string; sourcePath: string; description: string; classification: CompletenessClassification; canonicalTarget?: string; authorityRule: string; sensitivity: "ordinary" | "personal" | "restricted"; mapperVersion: string; decisionReason: string };
type GovernanceIssue = { issueId: string; code: string; severity: "blocking" | "warning"; entityReference: string; message: string };

export const BrightHrCompleteness: CompletenessField[] = [
  field("employee-id", "employee.id", "Stable BrightHR employee identifier", "mapped-now", "Legend.externalIdentities", "Provider identity only; it never becomes canonical identity."),
  field("display-name", "employee.name", "Official/display name components", "mapped-now", "Legend.displayName", "BrightHR supplies the provider fact; reviewed preferred name remains FIKA-owned."),
  field("work-email", "employee.email", "Provider employee email field currently mapped as work email", "mapped-now", "Legend.workEmail", "BrightHR provider fact pending contact-field governance.", "personal"),
  field("employment-status", "employee.employment.status", "Employment status", "mapped-now", "Employment.employmentState", "BrightHR is the provider authority for employment state."),
  field("start-date", "employee.employment.start", "Employment start date", "mapped-now", "Employment.startDate", "BrightHR provider fact; preserve only when observed and never infer."),
  field("termination-date", "employee.employment.terminationDate", "Employment termination/end date", "mapped-now", "Employment.terminationDate", "BrightHR is the provider authority; missing remains missing."),
  field("job-title", "employee.employment.jobTitle", "Contractual or provider-reported job title", "mapped-now", "Employment.contractualJobTitle", "BrightHR provider fact; contractual meaning requires provider confirmation."),
  field("contract-hours", "employee.employment.contractHours", "Contracted working hours", "unknown-investigation", "Employment.contractHours", "Preserve only when observed and target meaning is confirmed."),
  field("work-location", "employee.employment.workLocation(s)", "Provider work-location references", "retained-not-mapped", undefined, "Provider labels require reviewed mapping to an OPLOC; Site and Venue are classifications only."),
  field("personal-email", "employee.personalEmail", "Personal email", "restricted-sensitive", undefined, "Not permitted on ordinary Legend records.", "restricted"),
  field("phone", "employee.phone(s)", "Phone numbers", "restricted-sensitive", undefined, "Requires explicit contact purpose and access policy.", "restricted"),
  field("emergency-contact", "employee.emergencyContacts", "Emergency contacts", "restricted-sensitive", undefined, "Must never be placed on the ordinary Legend aggregate.", "restricted"),
  field("absence-type", "absence.type", "Absence classification", "mapped-now", "Absence.absenceType", "BrightHR provider fact; operational display is permission-controlled."),
  field("absence-description", "absence.description", "Free-text absence detail", "restricted-sensitive", undefined, "Restricted HR detail; excluded from ordinary operational views.", "restricted"),
  field("hr-documents", "employee.documents / absence.documents", "HR document references", "restricted-sensitive", undefined, "Restricted evidence; not part of the ordinary Registry.", "restricted"),
];

export const RotaCompleteness: CompletenessField[] = [
  rotaField("legend-name", "legend.displayName", "Name used for evidence matching", "mapped-now", "Operational Placement Evidence.sourceIdentity", "Exact normalised matching proposes evidence only."),
  rotaField("site-label", "legend.sites[].name", "Original rota location label", "mapped-now", "Operational Placement Evidence.sourceLocationLabel", "Must be reviewed against a stable OPLOC identity; source wording is evidence, not a classification."),
  rotaField("weeks", "legend.sites[].weeksObserved", "Number of workbook weeks observed", "retained-not-mapped", undefined, "Evidence strength only; never proves a permanent assignment."),
  rotaField("appearances", "legend.sites[].appearances", "Observed or scheduled appearances", "retained-not-mapped", undefined, "Must be interpreted against dates before use."),
  rotaField("latest-week", "legend.sites[].latestWeek", "Latest evidence week", "mapped-now", "Operational Placement Evidence.observedTo", "Future dates are scheduled evidence, not completed work."),
];

function field(id: string, sourcePath: string, description: string, classification: CompletenessClassification, canonicalTarget: string | undefined, authorityRule: string, sensitivity: CompletenessField["sensitivity"] = "ordinary"): CompletenessField { return { fieldId: `brighthr:${id}`, provider: "brighthr", providerEntity: sourcePath.startsWith("absence") ? "absence" : "employee", sourcePath, description, classification, canonicalTarget, authorityRule, sensitivity, mapperVersion: "brighthr-mapper:1", decisionReason: "Current connector and mapper inspection; unresolved entries require provider evidence." }; }
function rotaField(id: string, sourcePath: string, description: string, classification: CompletenessClassification, canonicalTarget: string | undefined, authorityRule: string): CompletenessField { return { fieldId: `rota:${id}`, provider: "rota", providerEntity: "placement-evidence", sourcePath, description, classification, canonicalTarget, authorityRule, sensitivity: "personal", mapperVersion: "rota-enrichment:1", decisionReason: "Current All Sites Rota parser and evidence boundary." }; }

export function lifecycleOf(record: CanonicalRecord): CanonicalLifecycle { return record.lifecycleStatus || (record.publicationStatus === "published" ? "published" : record.publicationStatus === "withdrawn" ? "archived" : "needs-review"); }

export function governanceIssues(canonical: CanonicalRecord[], staging: StagingRecord[]) {
  const issues: GovernanceIssue[] = [];
  for (const record of canonical) {
    if (!record.lifecycleStatus && !record.publicationStatus) issues.push(issue("MISSING_LIFECYCLE", record.canonicalId, "blocking", "Canonical candidate has no explicit lifecycle and is excluded from downstream publication."));
    if (lifecycleOf(record) === "published") for (const reference of referencedIds(record.record)) if (!canonical.some(candidate => candidate.canonicalId === reference && lifecycleOf(candidate) === "published")) issues.push(issue("BROKEN_PUBLISHED_REFERENCE", `${record.canonicalId}:${reference}`, "blocking", `Published record references unavailable canonical identity ${reference}.`));
    if (record.entityType === "Legend" && restrictedLegendLeak(record.record)) issues.push(issue("RESTRICTED_LEGEND_FIELD", record.canonicalId, "blocking", "Restricted HR data appears on an ordinary Legend record."));
  }
  // Rota matching is optional placement evidence only. No match, an ambiguous
  // match or evidence across multiple locations is not a canonical data issue
  // and never blocks a Legend. Reviewed Operational Assignments remain the
  // authoritative working-location relationship.
  // Archived Legends remain immutable history after a governed merge. They no
  // longer compete for current identity uniqueness.
  const legends = canonical.filter(
    record => record.entityType === "Legend" && lifecycleOf(record) !== "archived",
  );
  addDuplicateIssues(legends, record => normalise(String(record.record.displayName || "")), "DUPLICATE_NORMALISED_NAME", "Multiple Legend candidates share the same normalised name.", issues);
  addDuplicateIssues(legends, record => normalise(String(record.record.workEmail || "")), "DUPLICATE_WORK_EMAIL", "Multiple Legend candidates share the same work email.", issues);
  const identityGroups = new Map<string, CanonicalRecord[]>();
  for (const record of legends) for (const identity of Array.isArray(record.record.externalIdentities) ? record.record.externalIdentities : []) if (identity && typeof identity === "object") { const value = `${String((identity as Record<string, unknown>).provider || "")}:${String((identity as Record<string, unknown>).externalId || "")}`; if (value !== ":") identityGroups.set(value, [...(identityGroups.get(value) || []), record]); }
  for (const [identity, records] of identityGroups) if (records.length > 1) issues.push(issue("CONFLICTING_EXTERNAL_IDENTITY", identity, "blocking", "One provider identity is linked to multiple Legend candidates."));
  return [...new Map(issues.map(value => [value.issueId, value])).values()];
}

function issue(code: string, key: string, severity: "blocking" | "warning", message: string) { return { issueId: `issue:${crypto.createHash("sha256").update(`${code}:${key}`).digest("hex").slice(0, 24)}`, code, severity, entityReference: key, message }; }
function referencedIds(record: Record<string, unknown>) { return Object.entries(record).filter(([key, value]) => /(?:Id|Ids)$/.test(key) && key !== "canonicalId" && key !== "provenanceIds" && key !== "sourceReference" && value).flatMap(([, value]) => Array.isArray(value) ? value.map(String) : [String(value)]).filter(value => /^(?:legend|site|oploc|employment|absence|source-mapping|site-assignment):/.test(value)); }
function restrictedLegendLeak(record: Record<string, unknown>) { return ["personalEmail", "phone", "phoneNumber", "emergencyContact", "emergencyContacts", "absenceDescription", "documents"].some(key => record[key] !== undefined); }
function addDuplicateIssues(records: CanonicalRecord[], key: (record: CanonicalRecord) => string, code: string, message: string, output: GovernanceIssue[]) { const groups = new Map<string, CanonicalRecord[]>(); for (const record of records) { const value = key(record); if (value) groups.set(value, [...(groups.get(value) || []), record]); } for (const [value, matches] of groups) if (matches.length > 1) output.push(issue(code, value, "warning", message)); }
function normalise(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
