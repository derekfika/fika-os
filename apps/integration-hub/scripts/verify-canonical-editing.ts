import assert from "node:assert/strict";
import { db } from "../lib/firebase-admin";
import { approveAddress, saveCanonicalChange } from "../lib/canonical-record-service";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8185") throw new Error("This mutation verification may run only against the isolated recovery emulator on 127.0.0.1:8185.");
const actor = { uid: "person:isolated-test-admin", name: "Isolated Test Administrator", role: "integration-admin", synthetic: true } satisfies Actor;
const reason = "Isolated emulator verification of the governed save pipeline.";
const ids = ["legend:isolated-editor-test", "oploc:isolated-editor-test", "operational-assignment:isolated-editor-test", "cap:isolated-editor-test", "capability-enablement:isolated-editor-test", "address:isolated-editor-test"];
const failedAtomicIds = ["oploc:isolated-atomic-failure", "address:isolated-atomic-failure"];

try {
  const legend = await saveCanonicalChange(actor, { entityType: "Legend", canonicalId: ids[0], expectedVersion: 0, values: { displayName: "Isolated Legend", preferredName: "Isolated" }, decisionReason: reason });
  const oploc = await saveCanonicalChange(actor, { entityType: "OPLOC", canonicalId: ids[1], expectedVersion: 0, values: { approvedName: "Isolated House", primaryLocationType: "Site", locationTypeEffectiveFrom: "2026-07-29", lifecycleState: "active", aliases: ["Fixture House"] }, decisionReason: reason, inlineAddress: { canonicalId: ids[5], expectedVersion: 0, values: { addressLine1: "Suite 1", addressLine2: "10 Isolated Road", locality: "London", postalCode: "W1A 1AA", countryCode: "GB", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason } });
  const assignment = await saveCanonicalChange(actor, { entityType: "Operational Assignment", canonicalId: ids[2], expectedVersion: 0, values: { legendId: ids[0], oplocId: ids[1], assignmentRole: "Site Manager", designation: "primary", effectiveFrom: "2026-07-28", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason });
  const capability = await saveCanonicalChange(actor, { entityType: "Operational Capability", canonicalId: ids[3], expectedVersion: 0, values: { capabilityName: "Isolated Hospitality", owningDomainId: "domain:hospitality", businessPurpose: "Verify the isolated governed catalogue path.", lifecycleState: "active", effectiveFrom: "2026-07-28" }, decisionReason: reason });
  const enablement = await saveCanonicalChange(actor, { entityType: "Capability Enablement", canonicalId: ids[4], expectedVersion: 0, values: { capabilityId: ids[3], oplocId: ids[1], state: "enabled", businessOwnerRoleId: "role:operations-manager", effectiveFrom: "2026-07-28" }, decisionReason: reason });
  for (const result of [legend, oploc, assignment, capability, enablement]) { assert.equal(result.publicationOccurred, false); assert.equal(result.record.lifecycleStatus, "needs-review"); assert.equal(result.record.publicationStatus, undefined); }
  assert.equal(oploc.record.record.addressReference, ids[5]); assert.equal(oploc.addressRecord?.record.approvalState, "approved"); assert.equal(oploc.addressRecord?.lifecycleStatus, "published"); assert.equal(oploc.addressRecord?.publicationStatus, "published");
  const approvedAddress = await approveAddress(actor, { canonicalId: ids[5], expectedVersion: 1, note: "Isolated structured Address reviewed." });
  assert.equal(approvedAddress.record.record.approvalState, "approved"); assert.equal(approvedAddress.publicationOccurred, false); assert.equal(approvedAddress.record.lifecycleStatus, "published");

  await assert.rejects(() => saveCanonicalChange(actor, { entityType: "Legend", canonicalId: ids[0], expectedVersion: 0, values: { displayName: "Stale overwrite" }, decisionReason: reason }), /changed after the editor opened/);
  await assert.rejects(() => saveCanonicalChange(actor, { entityType: "Operational Assignment", canonicalId: "operational-assignment:isolated-broken", expectedVersion: 0, values: { legendId: "legend:does-not-exist", oplocId: ids[1], assignmentRole: "Support", designation: "secondary", effectiveFrom: "2026-07-28", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason }), /does not exist/);
  await assert.rejects(() => saveCanonicalChange(actor, { entityType: "Address", canonicalId: "address:isolated-duplicate", expectedVersion: 0, values: { addressLine1: "Suite 1", addressLine2: "10 Isolated Road", locality: "London", postalCode: "W1A 1AA", countryCode: "GB", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason }), /possible Address match/);
  await assert.rejects(() => saveCanonicalChange(actor, { entityType: "OPLOC", canonicalId: failedAtomicIds[0], expectedVersion: 0, values: { approvedName: "Invalid Atomic House", primaryLocationType: "Hospitality", locationTypeEffectiveFrom: "2026-07-29", lifecycleState: "active", aliases: [] }, decisionReason: reason, inlineAddress: { canonicalId: failedAtomicIds[1], expectedVersion: 0, values: { addressLine1: "10 Failed Road", locality: "London", postalCode: "EC1A 1BB", countryCode: "GB", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason } }), /Site or Venue/);
  assert.equal((await db.collection("integrationHubCanonical").doc(stableDocumentId(failedAtomicIds[1])).get()).exists, false);

  const addressRef = db.collection("integrationHubCanonical").doc(stableDocumentId(ids[5]));
  const locked = (await addressRef.get()).data()!; locked.record.ownership.fikaOwned.fieldLocks = ["addressLine1"]; await addressRef.set(locked);
  await assert.rejects(() => saveCanonicalChange(actor, { entityType: "Address", canonicalId: ids[5], expectedVersion: 2, values: { addressLine1: "Changed Suite", addressLine2: "10 Isolated Road", locality: "London", postalCode: "W1A 1AA", countryCode: "GB", lifecycleState: "active", evidenceReferences: [] }, decisionReason: reason, allowDistinctDuplicate: true }), /Locked fields cannot be changed/);

  const revisions = await db.collection("integrationHubCanonicalRevisions").where("canonicalId", "in", ids).get();
  const audits = await Promise.all(ids.map(id => db.collection("integrationHubGovernanceAudit").where("entityReference", "==", id).get()));
  assert.equal(revisions.size, 7); assert.equal(audits.reduce((total, snapshot) => total + snapshot.size, 0), 7);
  console.log(JSON.stringify({ verified: true, createdCandidates: 6, revisions: revisions.size, audits: 7, atomicAddressAndOploc: true, automaticAddressPublication: true, atomicFailureRolledBack: true, duplicateRejectedUntilReviewed: true, fieldLockRejected: true, staleConflictRejected: true, brokenReferenceRejected: true }, null, 2));
} finally {
  for (const id of ids) await db.collection("integrationHubCanonical").doc(stableDocumentId(id)).delete().catch(() => undefined);
  await deleteQueries([db.collection("integrationHubCanonicalRevisions").where("canonicalId", "in", ids), ...ids.map(id => db.collection("integrationHubGovernanceAudit").where("entityReference", "==", id))]);
  await db.collection("integrationHubCanonical").doc(stableDocumentId("operational-assignment:isolated-broken")).delete().catch(() => undefined);
  await db.collection("integrationHubCanonical").doc(stableDocumentId("address:isolated-duplicate")).delete().catch(() => undefined);
  for (const id of failedAtomicIds) await db.collection("integrationHubCanonical").doc(stableDocumentId(id)).delete().catch(() => undefined);
}

async function deleteQueries(queries: FirebaseFirestore.Query[]) { for (const query of queries) { const snapshot = await query.get(); const batch = db.batch(); for (const document of snapshot.docs) batch.delete(document.ref); if (!snapshot.empty) await batch.commit(); } }
