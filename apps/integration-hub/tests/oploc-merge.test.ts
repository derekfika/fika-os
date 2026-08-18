import assert from "node:assert/strict";
import test from "node:test";
import { acceptedPublishedOplocPage } from "../lib/canonical-boundary";
import { planOplocMerge, resolveOplocId } from "../lib/oploc-merge";
import type { CanonicalRecord } from "../lib/types";

const timestamp = "2026-07-29T20:30:00.000Z";
const survivorId = "oploc:munich-re";
const formerId = "oploc:munich-re-5th-floor";

function record(
  entityType: string,
  canonicalId: string,
  values: Record<string, unknown>,
): CanonicalRecord {
  const body = {
    schemaVersion: "0.1.0",
    version: 1,
    createdAt: timestamp,
    createdBy: "person:test",
    updatedAt: timestamp,
    updatedBy: "person:test",
    active: true,
    externalIdentities: [],
    provenanceIds: [],
    ownership: { providerOwned: {}, fikaOwned: {} },
    entityType,
    canonicalId,
    ...values,
  };
  return { entityType: entityType as CanonicalRecord["entityType"], canonicalId, record: body, dataHash: "test", lifecycleStatus: "published", publicationStatus: "published" };
}

function oploc(canonicalId: string, name: string) {
  return record("OPLOC", canonicalId, {
    approvedName: name,
    primaryLocationType: "Site",
    lifecycleState: "active",
    locationTypeHistory: [{ assignmentId: `location-type:${canonicalId}`, locationType: "Site", effectiveFrom: timestamp, approvedBy: "person:test", approvedAt: timestamp, reason: "Created for the focused merge test." }],
    aliases: [],
  });
}

test("an OPLOC merge retains the former identity and redirects supported relationships", () => {
  const survivor = oploc(survivorId, "Munich RE");
  const former = oploc(formerId, "Munich RE 5th Floor");
  const assignment = record("Site Role Assignment", "site-role-assignment:one", {
    legendId: "legend:one",
    oplocId: formerId,
    staffingRoleId: "staffing-role:barista",
    effectiveFrom: "2026-07-29",
    primaryLocation: false,
    lifecycleState: "active",
  });
  const plan = planOplocMerge([survivor, former, assignment], {
    survivorOplocId: survivorId,
    formerOplocId: formerId,
    formerNameAlias: "Munich RE 5th Floor",
    actorId: "person:test",
    timestamp,
  });
  assert.equal(plan.former.record.lifecycleState, "merged");
  assert.equal(plan.former.record.mergedIntoOplocId, survivorId);
  assert.equal(plan.former.record.active, false);
  assert.equal(
    (plan.survivor.record.aliases as { alias: string }[])[0]?.alias,
    "Munich RE 5th Floor",
  );
  assert.equal(plan.redirectedRecords[0]?.record.oplocId, survivorId);
  assert.equal(plan.redirectedRecords[0]?.canonicalId, assignment.canonicalId);
  assert.equal(resolveOplocId([plan.survivor, plan.former], formerId), survivorId);
});

test("repeating the already-applied merge makes no new relationship changes", () => {
  const first = planOplocMerge([oploc(survivorId, "Munich RE"), oploc(formerId, "Munich RE 5th Floor")], {
    survivorOplocId: survivorId,
    formerOplocId: formerId,
    formerNameAlias: "Munich RE 5th Floor",
    actorId: "person:test",
    timestamp,
  });
  const second = planOplocMerge([first.survivor, first.former], {
    survivorOplocId: survivorId,
    formerOplocId: formerId,
    formerNameAlias: "Munich RE 5th Floor",
    actorId: "person:test",
    timestamp,
  });
  assert.equal(second.redirectedRecords.length, 0);
  assert.equal(second.survivor.record.version, first.survivor.record.version);
  assert.equal(second.former.record.version, first.former.record.version);
});

test("a merged OPLOC resolves historically but is excluded from active OPLOC results", () => {
  const other = oploc("oploc:unrelated", "Unrelated OPLOC");
  const plan = planOplocMerge([oploc(survivorId, "Munich RE"), oploc(formerId, "Munich RE 5th Floor"), other], {
    survivorOplocId: survivorId,
    formerOplocId: formerId,
    formerNameAlias: "Munich RE 5th Floor",
    actorId: "person:test",
    timestamp,
  });
  const page = acceptedPublishedOplocPage([plan.survivor, plan.former, other], { limit: 10 });
  assert.deepEqual(page.records.map((record) => record.canonicalId).sort(), [survivorId, other.canonicalId].sort());
  assert.equal(resolveOplocId([plan.survivor, plan.former], formerId), survivorId);
  assert.equal(other.record.lifecycleState, "active");
});
