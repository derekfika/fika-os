import assert from "node:assert/strict";
import test from "node:test";
import { buildOplocAlignmentReport, locationTypeIsSupported, operationalFunctionIsLocationType, proposeOplocCompatibility } from "../lib/oploc-alignment";
import { parseCanonical } from "../lib/schemas";
import { publicationAssessment } from "../lib/governance-repository";
import type { CanonicalRecord } from "../lib/types";

const timestamp = "2026-07-28T12:00:00.000Z";
const common = { schemaVersion: "0.1.0", version: 1, createdAt: timestamp, createdBy: "person:integration-admin", updatedAt: timestamp, updatedBy: "person:integration-admin", active: true, externalIdentities: [], provenanceIds: ["provenance:synthetic"], ownership: { providerOwned: {}, fikaOwned: {} } };
const source = { canonicalId: "site:legacy", entityType: "Site", dataHash: "hash", lifecycleStatus: "needs-review", record: { ...common, entityType: "Site", canonicalId: "site:legacy", name: "Synthetic House", externalIdentities: [{ provider: "square", externalId: "square-location-one" }] } } as CanonicalRecord;

test("OPLOC is the durable identity and Location Type history may change without replacing it", () => {
  const first = { ...common, entityType: "OPLOC", canonicalId: "oploc:synthetic", approvedName: "Synthetic House", primaryLocationType: "Venue", lifecycleState: "active", aliases: [], locationTypeHistory: [{ assignmentId: "location-type:one", locationType: "Venue", effectiveFrom: timestamp, approvedBy: "person:integration-admin", approvedAt: timestamp, reason: "Initial governed Venue classification." }] };
  const changed = { ...first, primaryLocationType: "Site", locationTypeHistory: [{ ...first.locationTypeHistory[0], effectiveTo: "2026-08-01T00:00:00.000Z" }, { assignmentId: "location-type:two", locationType: "Site", effectiveFrom: "2026-08-01T00:00:00.000Z", approvedBy: "person:integration-admin", approvedAt: "2026-07-30T12:00:00.000Z", reason: "Reviewed change to ongoing operational presence." }] };
  assert.equal(parseCanonical("OPLOC", first).success, true);
  assert.equal(parseCanonical("OPLOC", changed).success, true);
  assert.equal(changed.canonicalId, first.canonicalId);
  assert.equal(parseCanonical("OPLOC", { ...changed, primaryLocationType: "CPU" }).success, false);
  assert.equal(parseCanonical("OPLOC", { ...changed, parentOplocId: "oploc:parent" }).success, false);
});

test("Site and Venue are the only Location Types and operational functions are not types", () => {
  assert.equal(locationTypeIsSupported("Site"), true); assert.equal(locationTypeIsSupported("Venue"), true); assert.equal(locationTypeIsSupported("Restaurant"), false);
  assert.equal(operationalFunctionIsLocationType("Coffee Bar"), true); assert.equal(operationalFunctionIsLocationType("CPU"), true); assert.equal(operationalFunctionIsLocationType("Venue"), false);
});

test("legacy Site alignment is deterministic, non-destructive and remains needs-review", () => {
  const first = proposeOplocCompatibility(source, []), second = proposeOplocCompatibility(source, []);
  assert.deepEqual(first, second); assert.equal(first.sourceCanonicalId, "site:legacy"); assert.equal(first.lifecycleStatus, "needs-review"); assert.equal(first.proposedPrimaryLocationType, "Site"); assert.equal(first.preservesExistingId, false);
  const report = buildOplocAlignmentReport([source]); assert.equal(report.dryRun, true); assert.equal(report.writesPerformed, 0); assert.equal(report.idPreservation.requiresMapping, 1);
});

test("duplicate OPLOC evidence is detected without approving a match", () => {
  const oploc = { canonicalId: "oploc:existing", entityType: "OPLOC", dataHash: "hash", lifecycleStatus: "needs-review", record: { approvedName: "Synthetic House", externalIdentities: [] } } as CanonicalRecord;
  const proposal = proposeOplocCompatibility(source, [oploc]); assert.equal(proposal.duplicateCandidates.length, 1); assert.equal(proposal.duplicateCandidates[0].canonicalId, "oploc:existing");
});

test("publication readiness accepts the Legend definition but still blocks unreviewed records and legacy entity types", () => {
  assert.equal(publicationAssessment(source, [source]).publicationEligible, false);
  const legend = { canonicalId: "legend:one", entityType: "Legend", dataHash: "hash", lifecycleStatus: "needs-review", record: { ...common, entityType: "Legend", canonicalId: "legend:one", displayName: "Synthetic Legend" } } as CanonicalRecord;
  const assessment = publicationAssessment(legend, [legend]); assert.equal(assessment.definitionStatus, "accepted-canon"); assert.equal(assessment.publicationEligible, false); assert.ok(assessment.blockers.includes("Governed human decision provenance is missing"));
});
