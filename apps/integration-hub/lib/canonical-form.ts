import type { EditableEntityType } from "./canonical-editor";

export type CanonicalControl = "text" | "email" | "number" | "textarea" | "date" | "select" | "relationship" | "address-relationship" | "country" | "repeatable-text";
export type CanonicalFormField = { name: string; label: string; control: CanonicalControl; required?: boolean; values?: readonly string[]; relationshipType?: EditableEntityType; help?: string };

export const CanonicalFormFields: Record<EditableEntityType, readonly CanonicalFormField[]> = {
  OPLOC: [
    { name: "approvedName", label: "Approved name", control: "text", required: true, help: "The name FIKA will use for this location." },
    { name: "primaryLocationType", label: "Primary Location Type", control: "select", required: true, values: ["Site", "Venue"], help: "A Site is an ongoing FIKA operational location. A Venue is a location used to deliver events or services without becoming a Site." },
    { name: "locationTypeEffectiveFrom", label: "Location Type effective from", control: "date", required: true },
    { name: "addressReference", label: "Address", control: "address-relationship", relationshipType: "Address", help: "Select a reusable published Address or add a valid structured Address. OPLOC stores only its stable Address ID." },
    { name: "aliases", label: "Other known names", control: "repeatable-text", help: "Other names this place is known by. Enter one per line." },
    { name: "lifecycleState", label: "Lifecycle", control: "select", required: true, values: ["active", "decommissioned", "merged"] },
    { name: "mergedIntoOplocId", label: "Location that remains", control: "relationship", relationshipType: "OPLOC", help: "Choose the existing location that will remain after this merge." },
  ],
  Address: [
    { name: "addressLine1", label: "Address line 1", control: "text", required: true, help: "Use the premises or street line appropriate to this address." },
    { name: "addressLine2", label: "Address line 2", control: "text", help: "Optional building, floor, suite or additional street detail." },
    { name: "addressLine3", label: "Address line 3", control: "text", help: "Optional additional premises detail." },
    { name: "locality", label: "Town or city", control: "text", required: true },
    { name: "region", label: "County, state or region", control: "text" },
    { name: "postalCode", label: "Postcode or postal code", control: "text", help: "Required for GB addresses; optional where the country does not use postal codes." },
    { name: "countryCode", label: "Country", control: "country", required: true },
    { name: "lifecycleState", label: "Lifecycle", control: "select", required: true, values: ["active", "retired"] },
    { name: "evidenceReferences", label: "Evidence references", control: "repeatable-text", help: "Stable evidence references only. Provider payloads remain outside the canonical Address." },
  ],
  Legend: [
    { name: "displayName", label: "Approved name", control: "text", required: true, help: "The name FIKA will use for this Legend." },
    { name: "preferredName", label: "Preferred name", control: "text" },
    { name: "workEmail", label: "Work email", control: "email" },
  ],
  Employment: [
    { name: "legendId", label: "Legend", control: "relationship", relationshipType: "Legend", required: true },
    { name: "employmentState", label: "Employment state", control: "text", required: true, help: "Use the confirmed employment state. Provider evidence may be used as a starting point." },
    { name: "startDate", label: "Start date", control: "date", help: "Leave blank when the actual start date is not known." },
    { name: "terminationDate", label: "Termination date", control: "date", help: "Leave blank for ongoing employment or where the date is not known." },
    { name: "contractualJobTitle", label: "Contractual job title", control: "text" },
    { name: "contractHours", label: "Contract hours", control: "number" },
  ],
  "Operational Assignment": [
    { name: "legendId", label: "Legend", control: "relationship", relationshipType: "Legend", required: true },
    { name: "oplocId", label: "OPLOC", control: "relationship", relationshipType: "OPLOC", required: true },
    { name: "assignmentRole", label: "Assignment role or type", control: "text", required: true, help: "Open business wording; no closed role catalogue has been adopted." },
    { name: "designation", label: "Designation", control: "select", required: true, values: ["primary", "secondary"] },
    { name: "effectiveFrom", label: "Effective from", control: "date", required: true },
    { name: "effectiveTo", label: "Effective to", control: "date" },
    { name: "lifecycleState", label: "Lifecycle", control: "select", required: true, values: ["active", "ended", "archived"] },
    { name: "evidenceReferences", label: "Evidence references", control: "repeatable-text", help: "Optional references only. Rota evidence never creates the assignment." },
  ],
  "Operational Capability": [
    { name: "capabilityName", label: "Capability name", control: "text", required: true },
    { name: "owningDomainId", label: "Owning domain ID", control: "text", required: true },
    { name: "businessPurpose", label: "Business purpose", control: "textarea", required: true },
    { name: "eligibilitySummary", label: "Eligibility summary", control: "textarea" },
    { name: "lifecycleState", label: "Lifecycle", control: "select", required: true, values: ["active", "retired"] },
    { name: "effectiveFrom", label: "Effective from", control: "date", required: true },
    { name: "effectiveTo", label: "Effective to", control: "date" },
  ],
  "Capability Enablement": [
    { name: "capabilityId", label: "Operational Capability", control: "relationship", relationshipType: "Operational Capability", required: true },
    { name: "oplocId", label: "OPLOC", control: "relationship", relationshipType: "OPLOC", required: true },
    { name: "state", label: "Enablement state", control: "select", required: true, values: ["enabled", "disabled", "unavailable", "ineligible"] },
    { name: "businessOwnerRoleId", label: "Business owner role ID", control: "text", required: true },
    { name: "effectiveFrom", label: "Effective from", control: "date", required: true },
    { name: "effectiveTo", label: "Effective to", control: "date" },
    { name: "configurationReferenceId", label: "Configuration reference ID", control: "text" },
  ],
};
