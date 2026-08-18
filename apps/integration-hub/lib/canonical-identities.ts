import crypto from "node:crypto";
import type { EditableEntityType } from "./canonical-editor";

export type CanonicalIdEntityType =
  | EditableEntityType
  | "Staffing Role"
  | "Site Staffing Requirement"
  | "Site Role Assignment"
  | "Operational Area Type"
  | "Operational Area"
  | "Service Definition"
  | "Service Arrangement"
  | "Equipment Type"
  | "Equipment Asset"
  | "Equipment Allocation"
  | "Operational Team"
  | "Team Membership"
  | "Event Role"
  | "Event Staffing Preference"
  | "Hospitality Menu Item"
  | "Hospitality Menu Offering"
  | "Hospitality Menu Price"
  | "Hospitality Brochure Import"
  | "Hospitality Brochure Candidate";

export const CanonicalIdPrefixes: Record<CanonicalIdEntityType, string> = {
  OPLOC: "oploc:",
  Address: "address:",
  Legend: "legend:",
  Employment: "employment:",
  "Operational Assignment": "operational-assignment:",
  "Staffing Role": "staffing-role:",
  "Site Staffing Requirement": "site-staffing-requirement:",
  "Site Role Assignment": "site-role-assignment:",
  "Operational Capability": "cap:",
  "Capability Enablement": "capability-enablement:",
  "Operational Area Type": "operational-area-type:",
  "Operational Area": "operational-area:",
  "Service Definition": "service-definition:",
  "Service Arrangement": "service-arrangement:",
  "Equipment Type": "equipment-type:",
  "Equipment Asset": "equipment-asset:",
  "Equipment Allocation": "equipment-allocation:",
  "Operational Team": "operational-team:",
  "Team Membership": "team-membership:",
  "Event Role": "event-role:",
  "Event Staffing Preference": "event-staffing-preference:",
  "Hospitality Menu Item": "hospitality-menu-item:",
  "Hospitality Menu Offering": "hospitality-menu-offering:",
  "Hospitality Menu Price": "hospitality-menu-price:",
  "Hospitality Brochure Import": "hospitality-brochure-import:",
  "Hospitality Brochure Candidate": "hospitality-brochure-candidate:",
};

export function generateCanonicalId(entityType: CanonicalIdEntityType) {
  return `${CanonicalIdPrefixes[entityType]}${crypto.randomUUID()}`;
}

export function validateCanonicalId(entityType: CanonicalIdEntityType, canonicalId: string) {
  const prefix = CanonicalIdPrefixes[entityType];
  if (!canonicalId.startsWith(prefix) || !/^[a-z0-9][a-z0-9:-]{7,159}$/.test(canonicalId)) {
    throw new Error(`Canonical ID must use the immutable ${prefix} convention.`);
  }
}
