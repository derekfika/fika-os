import type { HubRole } from "./auth";
import type { CanonicalRecord } from "./types";
import type { HubState } from "./types";

const RESTRICTED_FIELDS = new Set(["personalEmail", "phone", "phoneNumber", "emergencyContact", "emergencyContacts", "absenceDescription", "description", "documents", "documentReferences", "medicalInformation"]);
const EMPLOYMENT_FIELDS = new Set(["workEmail", "jobTitle", "employmentState", "contractualJobTitle", "contractHours", "startDate", "terminationDate"]);

export function redactCanonical(record: CanonicalRecord, role: HubRole): CanonicalRecord {
  const next = structuredClone(record);
  next.record = redactObject(next.record, role, record.entityType);
  if (role !== "integration-admin") delete next.fieldProvenance;
  return next;
}

export function redactSourceEvidence(value: unknown, role: HubRole): unknown { return redactObject(value, role, "source"); }

export function redactHubState(state: HubState, role: HubRole): HubState {
  if (role !== "viewer") return state;
  const copy = structuredClone(state);
  copy.canonical = copy.canonical.map(record => redactCanonical(record, role));
  copy.staging = copy.staging.map(record => ({ ...record, raw: Object.fromEntries(["provider", "externalId", "providerVersion"].filter(key => record.raw[key] !== undefined).map(key => [key, record.raw[key]])), normalised: redactObject(record.normalised, role, record.entityType) }));
  copy.profiles = copy.profiles.map(profile => ({ ...profile, worksheets: profile.worksheets.map(worksheet => ({ ...worksheet, preview: [], columns: worksheet.columns.map(column => ({ ...column, examples: column.sensitive ? [] : column.examples })) })) }));
  return copy;
}

function redactObject(value: unknown, role: HubRole, entityType: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (RESTRICTED_FIELDS.has(key)) { output[key] = "[REDACTED]"; continue; }
    if (role === "viewer" && (entityType === "Employment" || entityType === "Absence" || entityType === "Legend") && EMPLOYMENT_FIELDS.has(key)) { output[key] = "[REDACTED]"; continue; }
    if (key === "ownership" && role !== "integration-admin") { output[key] = "[REDACTED: administrator evidence]"; continue; }
    output[key] = item;
  }
  return output;
}
