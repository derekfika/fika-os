import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  addressDuplicateCandidates,
  exactAddressCandidate,
  formatAddress,
  legacyAddressEvidence,
  likelyAddressCandidates,
  normaliseAddressValues,
  postcodeOnlyAddressCandidates,
} from "../lib/address";
import { hasPermission } from "../lib/authmod";
import { acceptedPublishedCanonicalPage } from "../lib/canonical-boundary";
import { buildCanonicalRecord, editorPreview } from "../lib/canonical-editor";
import {
  addressPublicationAssessment,
  buildAutomaticAddressPublication,
  isIdempotentOplocRetry,
} from "../lib/canonical-record-service";
import { CanonicalFormFields } from "../lib/canonical-form";
import { parseCanonical } from "../lib/schemas";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

const actor = {
  uid: "person:integration-admin",
  name: "Integration Administrator",
  role: "integration-admin",
  synthetic: true,
} satisfies Actor;
const reason = "Reviewed synthetic Address evidence for the governed fixture.";

function address(
  canonicalId = "address:synthetic",
  overrides: Record<string, unknown> = {},
) {
  return buildCanonicalRecord(
    {
      entityType: "Address",
      canonicalId,
      expectedVersion: 0,
      values: {
        addressLine1: "Suite 2",
        addressLine2: "10 Example Street",
        locality: "London",
        postalCode: "EC2R 7HJ",
        countryCode: "GB",
        lifecycleState: "active",
        evidenceReferences: [],
        ...overrides,
      },
      decisionReason: reason,
    },
    actor,
  );
}

function wrapper(
  record: Record<string, unknown>,
  lifecycleStatus: CanonicalRecord["lifecycleStatus"] = "needs-review",
): CanonicalRecord {
  return {
    canonicalId: String(record.canonicalId),
    entityType: "Address",
    record,
    dataHash: "synthetic",
    lifecycleStatus,
    ...(lifecycleStatus === "published"
      ? { publicationStatus: "published" as const }
      : {}),
  };
}

test("ADDR-001 is Accepted and LOC-003 remains authoritative and unchanged", () => {
  const root = path.resolve(
    "../../fika-platform-specs/docs/business-decisions",
  );
  const addressDecision = fs.readFileSync(
    path.join(root, "addr-001-canonical-address.md"),
    "utf8",
  );
  const loc003 = fs.readFileSync(
    path.join(root, "loc-003-operational-location-boundary.md"),
    "utf8",
  );
  assert.match(addressDecision, /\*\*Status:\*\* Accepted/);
  assert.match(
    addressDecision,
    /Address is canonical master data separate from OPLOC\./,
  );
  assert.match(
    addressDecision,
    /`addressReference` stores a stable Address ID, never formatted address text\./,
  );
  assert.match(
    loc003,
    /It does not own provider integrations, application configuration, branding, physical address master data/,
  );
});

test("Address accepts valid UK and non-UK structured records without provider payloads", () => {
  const uk = address();
  assert.equal(parseCanonical("Address", uk).success, true);
  assert.equal(uk.approvalState, "approved");
  assert.equal(uk.approvedBy, actor.uid);
  assert.equal(typeof uk.approvedAt, "string");
  assert.equal(
    formatAddress(uk),
    "Suite 2, 10 Example Street, London, EC2R 7HJ, GB",
  );
  const nonUk = address("address:international", {
    addressLine1: "1 Example Plaza",
    addressLine2: "",
    locality: "Dubai",
    postalCode: "",
    countryCode: "AE",
  });
  assert.equal(parseCanonical("Address", nonUk).success, true);
  assert.equal(
    parseCanonical("Address", { ...uk, postalCode: undefined }).success,
    false,
  );
  assert.equal(
    parseCanonical("Address", { ...uk, rawProviderPayload: { secret: true } })
      .success,
    false,
  );
  assert.equal(
    parseCanonical("Address", { ...uk, addressId: "address:different" })
      .success,
    false,
  );
});

test("OPLOC stores only a stable Address relationship and rejects embedded address fields", () => {
  const oploc = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:synthetic",
      values: {
        approvedName: "Synthetic House",
        primaryLocationType: "Site",
        locationTypeEffectiveFrom: "2026-07-29",
        lifecycleState: "active",
        addressReference: "address:synthetic",
        aliases: [],
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(oploc.addressReference, "address:synthetic");
  assert.equal(
    parseCanonical("OPLOC", { ...oploc, addressLine1: "Not allowed" }).success,
    false,
  );
  const field = CanonicalFormFields.OPLOC.find(
    (candidate) => candidate.name === "addressReference",
  );
  assert.equal(field?.control, "address-relationship");
  assert.equal(field?.relationshipType, "Address");
});

test("valid Address creation is automatically approved and published", () => {
  const preview = editorPreview(
    {
      entityType: "Address",
      canonicalId: "address:preview",
      values: {
        addressLine1: "10 Preview Road",
        locality: "London",
        postalCode: "W1A 1AA",
        countryCode: "GB",
        lifecycleState: "active",
        evidenceReferences: [],
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(preview.lifecycleAfterSave, "published");
  assert.equal(preview.publicationAfterSave, "published");
  assert.equal(preview.proposed.approvalState, "approved");
});

test("legacy Site evidence prefills conservatively and preserves the original", () => {
  const original =
    "Example Building, Suite 4, 10 Example Road, London, W1A 1AA, GB";
  const site = {
    canonicalId: "site:synthetic",
    entityType: "Site",
    dataHash: "synthetic",
    record: {
      name: "Synthetic",
      address: original,
      ownership: {
        providerOwned: { address: original, country: "GB" },
        fikaOwned: {},
      },
      externalIdentities: [],
    },
  } as unknown as CanonicalRecord;
  const evidence = legacyAddressEvidence(site)!;
  assert.equal(evidence.originals[0]?.value, original);
  assert.equal(evidence.proposed.locality, "London");
  assert.equal(evidence.proposed.postalCode, "W1A 1AA");
  assert.equal(evidence.proposed.countryCode, "GB");
  assert.deepEqual(evidence.proposed.evidenceReferences, ["site:synthetic"]);
  assert.match(evidence.warnings[0]!, /remain unapproved/);
});

test("duplicate checks warn but do not merge shared-postcode sub-premises", () => {
  const existing = wrapper(address());
  const exact = addressDuplicateCandidates(
    address("address:new"),
    [existing],
    "address:new",
  );
  assert.equal(exact[0]?.reason, "Exact normalised structured-address match");
  assert.equal(exactAddressCandidate(exact)?.canonicalId, "address:synthetic");
  const otherSuite = address("address:other-suite", {
    addressLine1: "Suite 9",
  });
  const possible = addressDuplicateCandidates(
    otherSuite,
    [existing],
    "address:other-suite",
  );
  assert.equal(
    possible[0]?.reason,
    "Same postal code; separate sub-premises may still be legitimate",
  );
  assert.equal(existing.canonicalId, "address:synthetic");
});

test("Address values normalise whitespace, capitalisation and UK postcode formatting", () => {
  assert.deepEqual(
    normaliseAddressValues({
      addressLine1: "  10 EXAMPLE   STREET ",
      locality: "LONDON",
      postalCode: "ec2r7hj",
      countryCode: "gb",
    }),
    {
      addressLine1: "10 Example Street",
      locality: "London",
      postalCode: "EC2R 7HJ",
      countryCode: "GB",
      lifecycleState: "active",
      evidenceReferences: [],
    },
  );
});

test("an inline Address and OPLOC form one valid relationship using only the stable Address ID", () => {
  const publishedAddress = address("address:inline");
  const oploc = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:inline",
      expectedVersion: 0,
      values: {
        approvedName: "Inline House",
        primaryLocationType: "Site",
        locationTypeEffectiveFrom: "2026-07-29",
        lifecycleState: "active",
        addressReference: publishedAddress.canonicalId,
        aliases: [],
      },
      decisionReason: reason,
    },
    actor,
  );
  assert.equal(publishedAddress.approvalState, "approved");
  assert.equal(oploc.addressReference, "address:inline");
  assert.equal("addressLine1" in oploc, false);
});

test("an OPLOC cannot be left with an unpublished inline Address when publication fails", () => {
  const pending = wrapper(address("address:pending"));
  const publication = buildAutomaticAddressPublication(actor, pending, reason);
  assert.equal(publication.next.lifecycleStatus, "published");
  assert.equal(publication.next.publicationStatus, "published");
  assert.throws(
    () =>
      buildAutomaticAddressPublication(
        actor,
        wrapper(address("address:retired", { lifecycleState: "retired" })),
        reason,
      ),
    /Only an active Address/,
  );
  const service = fs.readFileSync(
    path.resolve("lib/canonical-record-service.ts"),
    "utf8",
  );
  assert.match(service, /return db\.runTransaction/);
  assert.match(
    service,
    /Address and OPLOC|automatically approved and published|existingAddressPublication/,
  );
});

test("retry detection reuses the saved OPLOC and Address relationship", () => {
  const record = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:retry",
      values: {
        approvedName: "Retry House",
        primaryLocationType: "Site",
        locationTypeEffectiveFrom: "2026-07-29",
        lifecycleState: "active",
        addressReference: "address:retry",
        aliases: ["Retry"],
      },
      decisionReason: reason,
    },
    actor,
  );
  const current = {
    canonicalId: "oploc:retry",
    entityType: "OPLOC",
    record,
    dataHash: "synthetic",
    lifecycleStatus: "needs-review",
  } as CanonicalRecord;
  assert.equal(
    isIdempotentOplocRetry(current, {
      entityType: "OPLOC",
      canonicalId: "oploc:retry",
      expectedVersion: 0,
      values: {
        approvedName: "Retry House",
        primaryLocationType: "Site",
        lifecycleState: "active",
        addressReference: "address:retry",
        aliases: ["Retry"],
      },
      decisionReason: reason,
    }),
    true,
  );
});

test("same-premises Address candidates require an explicit distinct choice", () => {
  const existing = wrapper(address(), "published");
  const candidates = addressDuplicateCandidates(
    address("address:near", { addressLine2: "10 Example Street Rear" }),
    [existing],
    "address:near",
  );
  assert.equal(candidates[0]?.exact, false);
  assert.equal(likelyAddressCandidates(candidates).length, 1);
});

test("a shared postcode with a different premises is informational and does not block saving", () => {
  const existing = wrapper(
    address("address:the-line", {
      addressLine1: "FIKA Catering",
      addressLine2: "58 Victoria Embankment",
    }),
    "published",
  );
  const candidates = addressDuplicateCandidates(
    address("address:regent-hall", {
      addressLine1: "Fika Regent Hall",
      addressLine2: "275 Oxford Street",
    }),
    [existing],
    "address:regent-hall",
  );
  assert.equal(
    candidates[0]?.reason,
    "Same postal code; separate sub-premises may still be legitimate",
  );
  assert.equal(likelyAddressCandidates(candidates).length, 0);
  assert.equal(postcodeOnlyAddressCandidates(candidates).length, 1);
});

test("bulk publication excludes incomplete and duplicate Addresses", () => {
  const publishable = wrapper(address("address:ready"));
  const duplicate = wrapper(address("address:duplicate"));
  const incomplete = wrapper({
    ...address("address:incomplete"),
    postalCode: undefined,
  });
  const assessment = addressPublicationAssessment([
    publishable,
    duplicate,
    incomplete,
  ]);
  assert.equal(assessment.publishable.length, 0);
  assert.equal(assessment.duplicates.length, 2);
  assert.equal(assessment.incomplete.length, 1);
});

test("AuthMod keeps Address actions separate and reviewers cannot approve or publish", () => {
  assert.equal(hasPermission(actor, "address.create"), true);
  assert.equal(hasPermission(actor, "address.approve"), true);
  assert.equal(hasPermission(actor, "oploc.link-address"), true);
  const reviewer = { ...actor, role: "reviewer" as const };
  assert.equal(hasPermission(reviewer, "address.edit"), true);
  assert.equal(hasPermission(reviewer, "address.approve"), false);
  assert.equal(hasPermission(reviewer, "address.publish"), false);
});

test("published API excludes unpublished Addresses and OPLOCs with unpublished Address references", () => {
  const addressRecord = wrapper(address(), "needs-review");
  const oplocRecord = buildCanonicalRecord(
    {
      entityType: "OPLOC",
      canonicalId: "oploc:published",
      values: {
        approvedName: "Published House",
        primaryLocationType: "Site",
        locationTypeEffectiveFrom: "2026-07-29",
        lifecycleState: "active",
        addressReference: addressRecord.canonicalId,
        aliases: [],
      },
      decisionReason: reason,
    },
    actor,
  );
  const publishedOploc = {
    canonicalId: "oploc:published",
    entityType: "OPLOC",
    record: oplocRecord,
    dataHash: "synthetic",
    lifecycleStatus: "published",
  } as CanonicalRecord;
  assert.equal(
    acceptedPublishedCanonicalPage([addressRecord], {
      entityType: "Address",
      limit: 50,
    }).records.length,
    0,
  );
  const page = acceptedPublishedCanonicalPage([publishedOploc, addressRecord], {
    entityType: "OPLOC",
    limit: 50,
  });
  assert.equal(page.records.length, 0);
  assert.deepEqual(page.brokenReferences, [
    { canonicalId: "oploc:published", reference: "address:synthetic" },
  ]);
});
