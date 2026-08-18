import assert from "node:assert/strict";
import test from "node:test";
import { planLegacyLifecycleResolution } from "../lib/governance-repository";
import type { CanonicalRecord } from "../lib/types";

const timestamp = "2026-07-29T12:00:00.000Z";
const actor = { uid: "person:integration-admin" };
const audit = {
  schemaVersion: "0.1.0",
  version: 1,
  createdAt: "2026-07-28T12:00:00.000Z",
  createdBy: actor.uid,
  updatedAt: "2026-07-28T12:00:00.000Z",
  updatedBy: actor.uid,
  active: true,
  externalIdentities: [],
  provenanceIds: ["provenance:legacy-approved"],
  ownership: { providerOwned: {}, fikaOwned: {} },
};

function wrap(
  entityType: CanonicalRecord["entityType"],
  canonicalId: string,
  record: Record<string, unknown>,
): CanonicalRecord {
  return {
    entityType,
    canonicalId,
    dataHash: "legacy-hash",
    record: { ...audit, entityType, canonicalId, ...record },
  };
}

test("accepted schema-valid legacy records and dependencies publish deterministically", () => {
  const address = wrap("Address", "address:legacy-one", {
    addressId: "address:legacy-one",
    addressLine1: "1 Angel Court",
    locality: "London",
    postalCode: "EC2R 7HJ",
    countryCode: "GB",
    lifecycleState: "active",
    approvalState: "approved",
    evidenceReferences: [],
    decisionReason: "Previously reviewed and approved address evidence.",
    approvedBy: actor.uid,
    approvedAt: "2026-07-28T12:00:00.000Z",
  });
  const oploc = wrap("OPLOC", "oploc:legacy-one", {
    approvedName: "One Angel Court",
    primaryLocationType: "Site",
    locationTypeHistory: [
      {
        assignmentId: "assignment:legacy-one",
        locationType: "Site",
        effectiveFrom: "2026-07-28T12:00:00.000Z",
        approvedBy: actor.uid,
        approvedAt: "2026-07-28T12:00:00.000Z",
        reason: "Previously reviewed location classification.",
      },
    ],
    lifecycleState: "active",
    addressReference: address.canonicalId,
    aliases: [],
  });

  const resolved = planLegacyLifecycleResolution(
    [oploc, address],
    actor,
    timestamp,
  );
  assert.equal(resolved.length, 2);
  assert.ok(resolved.every((record) => record.lifecycleStatus === "published"));
  assert.ok(resolved.every((record) => record.publicationStatus === "published"));
  assert.ok(resolved.every((record) => record.publishedAt === timestamp));
  assert.ok(resolved.every((record) => record.record.version === 2));
});

test("legacy, development and structurally blocked definitions receive an explicit review state but are not published", () => {
  const site = wrap("Site", "site:legacy-one", { name: "Legacy Site" });
  const category = wrap("Product Category", "product-category:legacy-one", {
    name: "Iced Drinks",
  });
  const legend = wrap("Legend", "legend:legacy-one", {
    displayName: "Synthetic Legend",
    jobTitle: "Barista",
  });

  const resolved = planLegacyLifecycleResolution(
    [site, category, legend],
    actor,
    timestamp,
  );
  assert.equal(resolved.length, 3);
  assert.ok(
    resolved.every(
      (record) =>
        record.lifecycleStatus === "needs-review" &&
        record.publicationStatus === undefined,
    ),
  );
});

test("records with an explicit lifecycle are never rewritten by legacy cleanup", () => {
  const published = {
    ...wrap("Legend", "legend:published", { displayName: "Published Legend" }),
    lifecycleStatus: "published" as const,
    publicationStatus: "published" as const,
  };
  assert.deepEqual(
    planLegacyLifecycleResolution([published], actor, timestamp),
    [],
  );
});

test("an accepted schema-valid needs-review record is published without another record-by-record decision", () => {
  const address = {
    ...wrap("Address", "address:ready", {
      addressId: "address:ready",
      addressLine1: "25 Synthetic Street",
      locality: "London",
      postalCode: "EC1A 1AA",
      countryCode: "GB",
      lifecycleState: "active",
      approvalState: "approved",
      evidenceReferences: [],
      decisionReason: "Previously reviewed and approved address evidence.",
      approvedBy: actor.uid,
      approvedAt: "2026-07-28T12:00:00.000Z",
    }),
    lifecycleStatus: "needs-review" as const,
  };
  const resolved = planLegacyLifecycleResolution([address], actor, timestamp);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.lifecycleStatus, "published");
  assert.equal(resolved[0]?.record.version, 2);
});

test("an explicit needs-review record with a real blocker is not rewritten repeatedly", () => {
  const blocked = {
    ...wrap("Legend", "legend:blocked", {
      displayName: "Synthetic Legend",
      employmentState: "Active",
    }),
    lifecycleStatus: "needs-review" as const,
  };
  assert.deepEqual(
    planLegacyLifecycleResolution([blocked], actor, timestamp),
    [],
  );
});
