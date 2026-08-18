import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  availableLifecycleActions,
  canonicalDisplayStatus,
  canonicalRecordFromMutationResponse,
  replaceCanonicalRecord,
} from "../lib/canonical-mutation-state";
import { buildAutomaticAddressPublication } from "../lib/canonical-record-service";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

const actor = {
  uid: "person:admin",
  name: "Integration Administrator",
  role: "integration-admin",
  synthetic: true,
} satisfies Actor;

function record(
  canonicalId: string,
  lifecycleStatus: CanonicalRecord["lifecycleStatus"] = "needs-review",
  entityType: CanonicalRecord["entityType"] = "Legend",
): CanonicalRecord {
  return {
    canonicalId,
    entityType,
    dataHash: `hash:${canonicalId}:${lifecycleStatus}`,
    lifecycleStatus,
    ...(lifecycleStatus === "published"
      ? { publicationStatus: "published" as const }
      : {}),
    record: {
      canonicalId,
      entityType,
      schemaVersion: "0.1.0",
      version: lifecycleStatus === "published" ? 2 : 1,
      createdAt: "2026-07-29T08:00:00.000Z",
      createdBy: actor.uid,
      updatedAt: "2026-07-29T09:00:00.000Z",
      updatedBy: actor.uid,
      active: true,
      externalIdentities: [],
      provenanceIds: [],
      ...(entityType === "Address"
        ? {
            addressId: canonicalId,
            addressLine1: "10 Example Street",
            locality: "London",
            postalCode: "EC2R 7HJ",
            countryCode: "GB",
            lifecycleState: "active",
            approvalState:
              lifecycleStatus === "published" ? "approved" : "pending",
            evidenceReferences: [],
            decisionReason: "Synthetic governed Address fixture.",
            ...(lifecycleStatus === "published"
              ? {
                  approvedBy: actor.uid,
                  approvedAt: "2026-07-29T09:00:00.000Z",
                }
              : {}),
            ownership: { providerOwned: {}, fikaOwned: { humanDecisions: [] } },
          }
        : { displayName: "Example Legend" }),
    },
  };
}

test("a completed publication response updates the open record and registry row together", () => {
  const before = record("legend:one"),
    after = record("legend:one", "published");
  const authoritative = canonicalRecordFromMutationResponse({
    mutation: { record: after },
  });
  assert.equal(authoritative, after);
  const registry = replaceCanonicalRecord(
    [before, record("legend:two")],
    authoritative!,
  );
  assert.equal(registry[0], after);
  assert.equal(canonicalDisplayStatus(authoritative!).publication, "published");
});

test("closing and reopening uses the updated registry instance", () => {
  const after = record("legend:one", "published");
  const registry = replaceCanonicalRecord([record("legend:one")], after);
  const reopened = registry.find((item) => item.canonicalId === "legend:one");
  assert.equal(reopened?.record.version, 2);
  assert.equal(reopened?.lifecycleStatus, "published");
});

test("automatic Address publication is Approved and Published in one persisted result", () => {
  const before = record("address:one", "needs-review", "Address");
  const publication = buildAutomaticAddressPublication(
    actor,
    before,
    "Automatically approved and published a complete Address.",
  );
  assert.deepEqual(canonicalDisplayStatus(publication.next), {
    lifecycle: "published",
    approval: "approved",
    publication: "published",
  });
  assert.equal(publication.next.record.approvedBy, actor.uid);
  assert.equal(publication.next.record.updatedBy, actor.uid);
});

test("a failed or incomplete mutation response cannot replace the previous visible state", () => {
  const before = record("legend:one");
  const authoritative = canonicalRecordFromMutationResponse({
    error: { message: "Publication failed." },
  });
  const incomplete = canonicalRecordFromMutationResponse({
    record: {
      canonicalId: "legend:one",
      entityType: "Legend",
      record: { version: 2 },
    },
  });
  assert.equal(authoritative, null);
  assert.equal(incomplete, null);
  assert.equal(before.lifecycleStatus, "needs-review");
  assert.deepEqual(availableLifecycleActions(before), [
    "return-to-draft",
    "publish",
  ]);
});

test("available lifecycle actions change immediately with the authoritative record", () => {
  assert.deepEqual(availableLifecycleActions(record("legend:one")), [
    "return-to-draft",
    "publish",
  ]);
  assert.deepEqual(
    availableLifecycleActions(record("legend:one", "published")),
    ["archive"],
  );
  assert.deepEqual(
    availableLifecycleActions(record("address:one", "needs-review", "Address")),
    ["publish-valid-address"],
  );
  assert.deepEqual(
    availableLifecycleActions(record("address:one", "published", "Address")),
    ["archive"],
  );
});

test("modal wiring waits for authority, offers retry, and never saves the stale prop", () => {
  const registry = fs.readFileSync(
    path.resolve("app/ui/DataRegistry.tsx"),
    "utf8",
  );
  const governanceRoute = fs.readFileSync(
    path.resolve("app/api/governance/route.ts"),
    "utf8",
  );
  assert.match(registry, /await acceptMutation\(body\)/);
  assert.match(registry, /Retry status refresh/);
  assert.match(registry, /replaceCanonicalRecord\(current\.records, record\)/);
  assert.doesNotMatch(registry, /close\(\);\s*await saved\(record\)/);
  assert.match(
    governanceRoute,
    /mutation = \{\s*record: await transitionCanonicalLifecycle/,
  );
  assert.match(governanceRoute, /Cache-Control.*no-store/);
});
