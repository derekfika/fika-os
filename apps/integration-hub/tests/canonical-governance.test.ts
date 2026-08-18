import assert from "node:assert/strict";
import test from "node:test";
import { BrightHrCompleteness, governanceIssues, lifecycleOf, RotaCompleteness } from "../lib/data-governance";
import { redactCanonical, redactHubState } from "../lib/redaction";
import { parseCanonical } from "../lib/schemas";
import { mergeProviderUpdate } from "../lib/mapping";
import type { CanonicalRecord } from "../lib/types";

const audit = { schemaVersion: "0.1.0" as const, version: 1, createdAt: "2026-07-28T12:00:00.000Z", createdBy: "person:integration-admin", updatedAt: "2026-07-28T12:00:00.000Z", updatedBy: "person:integration-admin", active: true, externalIdentities: [], provenanceIds: ["provenance:synthetic"] };
const ownership = { providerOwned: {}, fikaOwned: {} };

test("core relationship schemas keep employment and assignment separate from Legend", () => {
  assert.equal(parseCanonical("Employment", { ...audit, entityType: "Employment", canonicalId: "employment:synthetic", legendId: "legend:synthetic", employmentState: "Active", ownership }).success, true);
  assert.equal(parseCanonical("Site Assignment", { ...audit, entityType: "Site Assignment", canonicalId: "site-assignment:synthetic", legendId: "legend:synthetic", oplocId: "oploc:synthetic", assignmentType: "substantive", designation: "primary", assignmentStatus: "confirmed", evidenceReferences: [], ownership }).success, true);
  assert.equal(parseCanonical("Operational Placement Evidence", { ...audit, entityType: "Operational Placement Evidence", canonicalId: "placement-evidence:synthetic", sourceIdentity: "alex example", sourceLocationLabel: "Synthetic House", evidencePeriod: "future-scheduled", sourceReference: "source:synthetic", reviewStatus: "unresolved", ownership }).success, true);
});

test("records without explicit lifecycle are needs-review and never silently published", () => {
  const record = { canonicalId: "legend:synthetic", entityType: "Legend", record: {}, dataHash: "hash" } as CanonicalRecord;
  assert.equal(lifecycleOf(record), "needs-review");
  assert.equal(lifecycleOf({ ...record, lifecycleStatus: "published" }), "published");
});

test("completeness register covers restricted and unknown BrightHR fields", () => {
  assert.ok(BrightHrCompleteness.some(field => field.fieldId === "brighthr:emergency-contact" && field.classification === "restricted-sensitive"));
  assert.ok(BrightHrCompleteness.some(field => field.fieldId === "brighthr:start-date" && field.classification === "unknown-investigation"));
  assert.ok(RotaCompleteness.every(field => field.provider === "rota"));
});

test("central redaction removes employment and evidence details from ordinary viewers", () => {
  const record = { canonicalId: "legend:synthetic", entityType: "Legend", dataHash: "hash", record: { displayName: "Synthetic Legend", workEmail: "legend@example.invalid", terminationDate: "2026-07-01", emergencyContacts: [{ name: "Restricted" }], ownership } } as unknown as CanonicalRecord;
  const redacted = redactCanonical(record, "viewer");
  assert.equal(redacted.record.displayName, "Synthetic Legend");
  assert.equal(redacted.record.workEmail, "[REDACTED]");
  assert.equal(redacted.record.emergencyContacts, "[REDACTED]");
  assert.equal(redacted.record.ownership, "[REDACTED: administrator evidence]");
});

test("viewer hub payload removes raw evidence and sensitive workbook examples", () => {
  const state = { imports: [], canonical: [], mappings: [], syncRuns: [], activity: [], manifests: [], staging: [{ stagingId: "staging:synthetic", importId: "sync:synthetic", sourceRow: 1, entityType: "Legend" as const, raw: { provider: "brighthr", externalId: "employee:one", personalEmail: "restricted@example.invalid" }, normalised: { displayName: "Synthetic", workEmail: "restricted@example.invalid" }, issues: [], duplicateCandidates: [], state: "ready" as const, mappingVersion: 1 }], profiles: [{ importId: "import:synthetic", filename: "safe.xlsx", fileHash: "hash", proposedEntity: "Legend" as const, draftSchema: { status: "draft-proposal" as const, fields: [] }, worksheets: [{ name: "Sheet1", rowCount: 1, columnCount: 1, headerRow: 1, warnings: [], sourceRows: [2], preview: [{ personalEmail: "restricted@example.invalid" }], columns: [{ name: "personalEmail", inferredType: "email", blankPercentage: 0, uniqueValues: 1, examples: ["restricted@example.invalid"], likelyIdentifier: true, sensitive: true }] }] }] };
  const output = redactHubState(state, "viewer");
  assert.deepEqual(output.staging[0].raw, { provider: "brighthr", externalId: "employee:one" });
  assert.equal(output.staging[0].normalised.workEmail, "[REDACTED]");
  assert.deepEqual(output.profiles[0].worksheets[0].preview, []);
  assert.deepEqual(output.profiles[0].worksheets[0].columns[0].examples, []);
});

test("stable governance issues detect lifecycle gaps and restricted Legend leakage", () => {
  const record = { canonicalId: "legend:synthetic", entityType: "Legend", dataHash: "hash", record: { personalEmail: "restricted@example.invalid" } } as unknown as CanonicalRecord;
  const first = governanceIssues([record], []), second = governanceIssues([record], []);
  assert.deepEqual(first.map(issue => issue.issueId), second.map(issue => issue.issueId));
  assert.deepEqual(first.map(issue => issue.code).sort(), ["MISSING_LIFECYCLE", "RESTRICTED_LEGEND_FIELD"]);
});

test("field locks prevent provider refresh overwriting reviewed values", () => {
  const existing = { entityType: "Legend", canonicalId: "legend:synthetic", version: 1, displayName: "Reviewed Name", active: true, ownership: { providerOwned: { displayName: "Old Name" }, fikaOwned: { fieldLocks: ["displayName"] } } };
  const updated = mergeProviderUpdate(existing, { displayName: "Provider Changed Name" }, "person:admin");
  assert.equal(updated.displayName, "Reviewed Name");
  assert.equal(((updated.ownership as { providerOwned: Record<string, unknown> }).providerOwned).displayName, "Provider Changed Name");
});
