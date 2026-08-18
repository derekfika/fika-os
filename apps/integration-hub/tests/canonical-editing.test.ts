import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalRecord, editorPreview } from "../lib/canonical-editor";
import { CanonicalFormFields } from "../lib/canonical-form";
import {
  assertExpectedVersion,
  isGovernedPublishedEdit,
} from "../lib/canonical-record-service";
import { hasPermission } from "../lib/authmod";
import { parseCanonical } from "../lib/schemas";
import { publicationAssessment } from "../lib/governance-repository";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

const actor = {
  uid: "person:integration-admin",
  name: "Integration Administrator",
  role: "integration-admin",
  synthetic: true,
} satisfies Actor;
const reason = "Reviewed and approved for the synthetic canonical fixture.";

test("accepted definitions and AuthMod allow one authorised reviewer without granting reviewers approval", () => {
  assert.equal(hasPermission(actor, "canonical.create"), true);
  assert.equal(hasPermission(actor, "oploc.approve-identity"), true);
  assert.equal(hasPermission(actor, "legend.approve"), true);
  assert.equal(hasPermission(actor, "operational-assignment.approve"), true);
  assert.equal(
    hasPermission(actor, "operational-capability.approve-enablement"),
    true,
  );
  const reviewer = { ...actor, role: "reviewer" as const };
  assert.equal(hasPermission(reviewer, "canonical.edit"), true);
  assert.equal(hasPermission(reviewer, "oploc.approve-identity"), false);
  assert.equal(hasPermission(reviewer, "canonical.publish"), false);
});

test("Legend form exposes safe identity only and save preview never publishes", () => {
  assert.deepEqual(
    CanonicalFormFields.Legend.map((field) => field.name),
    ["displayName", "preferredName", "workEmail"],
  );
  const input = {
    entityType: "Legend" as const,
    canonicalId: "legend:synthetic",
    expectedVersion: 0,
    values: {
      displayName: "Synthetic Legend",
      preferredName: "Legend",
      workEmail: "legend@example.invalid",
    },
    decisionReason: reason,
  };
  const preview = editorPreview(input, actor);
  assert.equal(preview.lifecycleAfterSave, "needs-review");
  assert.equal(preview.publicationAfterSave, "unpublished");
  assert.equal(parseCanonical("Legend", preview.proposed).success, true);
  assert.equal("employmentState" in preview.proposed, false);
  assert.equal("jobTitle" in preview.proposed, false);
});

test("OPLOC keeps type history, rejects capabilities as Location Types and uses an address reference", () => {
  const record = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:synthetic",
      expectedVersion: 0,
      values: {
        approvedName: "Synthetic House",
        primaryLocationType: "Site",
        locationTypeEffectiveFrom: "2026-07-28",
        lifecycleState: "active",
        addressReference: "address:synthetic",
        aliases: ["Old Synthetic House"],
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(parseCanonical("OPLOC", record).success, true);
  assert.equal(record.addressReference, "address:synthetic");
  assert.equal("address" in record, false);
  assert.throws(
    () =>
      buildCanonicalRecord(
        {
          entityType: "OPLOC",
          canonicalId: "oploc:bad-type",
          values: {
            approvedName: "Bad",
            primaryLocationType: "Hospitality",
            locationTypeEffectiveFrom: "2026-07-28",
          },
          decisionReason: reason,
        },
        actor,
      ),
    /Site or Venue/,
  );
  const changed = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:synthetic",
      expectedVersion: 1,
      values: {
        approvedName: "Synthetic House",
        primaryLocationType: "Venue",
        locationTypeEffectiveFrom: "2026-08-01",
        lifecycleState: "active",
        aliases: ["Old Synthetic House"],
      },
      decisionReason:
        "Approved effective-dated change to Venue classification.",
    },
    actor,
    record,
  );
  assert.equal((changed.locationTypeHistory as unknown[]).length, 2);
  assert.equal(changed.canonicalId, record.canonicalId);
});

test("Operational Assignment is effective-dated, uses stable relationships and remains independent", () => {
  const record = buildCanonicalRecord(
    {
      entityType: "Operational Assignment",
      canonicalId: "operational-assignment:synthetic",
      values: {
        legendId: "legend:synthetic",
        oplocId: "oploc:synthetic",
        assignmentRole: "Site Manager",
        designation: "primary",
        effectiveFrom: "2026-06-29",
        lifecycleState: "active",
        evidenceReferences: [],
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(parseCanonical("Operational Assignment", record).success, true);
  assert.equal(record.legendId, "legend:synthetic");
  assert.equal(record.oplocId, "oploc:synthetic");
  assert.equal("siteId" in record, false);
  assert.equal(
    parseCanonical("Operational Assignment", {
      ...record,
      effectiveTo: "2026-01-01",
    }).success,
    false,
  );
});

test("Operational Capability and enablement stay separate from OPLOC type and permissions", () => {
  const capability = buildCanonicalRecord(
    {
      entityType: "Operational Capability",
      canonicalId: "cap:hospitality",
      values: {
        capabilityName: "Hospitality",
        owningDomainId: "domain:hospitality",
        businessPurpose: "Deliver governed hospitality services.",
        lifecycleState: "active",
        effectiveFrom: "2026-07-28",
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(
    parseCanonical("Operational Capability", capability).success,
    true,
  );
  const enablement = buildCanonicalRecord(
    {
      entityType: "Capability Enablement",
      canonicalId: "capability-enablement:synthetic",
      values: {
        capabilityId: "cap:hospitality",
        oplocId: "oploc:synthetic",
        state: "enabled",
        businessOwnerRoleId: "role:operations-manager",
        effectiveFrom: "2026-07-28",
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(
    parseCanonical("Capability Enablement", enablement).success,
    true,
  );
  assert.equal(enablement.oplocId, "oploc:synthetic");
  assert.equal("primaryLocationType" in enablement, false);
});

test("optimistic concurrency rejects stale editors", () => {
  const current = {
    canonicalId: "legend:synthetic",
    entityType: "Legend",
    dataHash: "hash",
    lifecycleStatus: "needs-review",
    record: { version: 2 },
  } as CanonicalRecord;
  assert.doesNotThrow(() => assertExpectedVersion(current, 2));
  assert.throws(
    () => assertExpectedVersion(current, 1),
    /changed after the editor opened/,
  );
  assert.throws(() => assertExpectedVersion(null, 2), /no longer matches/);
});

test("a published OPLOC uses the governed amendment path without losing publication", () => {
  const published = {
    canonicalId: "oploc:synthetic",
    entityType: "OPLOC",
    dataHash: "hash",
    lifecycleStatus: "published",
    publicationStatus: "published",
    record: { version: 2 },
  } as CanonicalRecord;
  const input = {
    entityType: "OPLOC" as const,
    canonicalId: published.canonicalId,
    expectedVersion: 2,
    values: { approvedName: "Renamed House" },
    decisionReason: reason,
  };
  assert.equal(isGovernedPublishedEdit(input, published), true);
  assert.equal(
    isGovernedPublishedEdit(
      { ...input, entityType: "Legend", canonicalId: "legend:synthetic" },
      { ...published, canonicalId: "legend:synthetic", entityType: "Legend" },
    ),
    false,
  );
  const assessment = publicationAssessment(published, [published]);
  assert.equal(assessment.alreadyPublished, true);
  assert.equal(assessment.publicationEligible, false);
  assert.equal(
    assessment.blockers.some((blocker) =>
      blocker.includes("Lifecycle must be needs-review"),
    ),
    false,
  );
});

test("publication assessment blocks legacy Employment fields and permits only reviewed clean Legend candidates", () => {
  const base = buildCanonicalRecord(
    {
      entityType: "Legend",
      canonicalId: "legend:clean",
      values: { displayName: "Clean Legend" },
      decisionReason: reason,
    },
    actor,
  );
  const wrapper = {
    canonicalId: "legend:clean",
    entityType: "Legend",
    dataHash: "hash",
    lifecycleStatus: "needs-review",
    record: base,
  } as CanonicalRecord;
  assert.equal(
    publicationAssessment(wrapper, [wrapper]).publicationEligible,
    true,
  );
  const legacy = {
    ...wrapper,
    canonicalId: "legend:legacy",
    record: {
      ...base,
      canonicalId: "legend:legacy",
      jobTitle: "Provider title",
    },
  } as CanonicalRecord;
  assert.equal(
    publicationAssessment(legacy, [legacy]).publicationEligible,
    false,
  );
  assert.ok(
    publicationAssessment(legacy, [legacy]).blockers.some((blocker) =>
      blocker.includes("Employment fields"),
    ),
  );
});
