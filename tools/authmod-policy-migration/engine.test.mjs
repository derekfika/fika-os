import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_EXCLUSIONS, APPROVED_ADMIN_REASON, COLLECTIONS, DEREK_IDENTITY,
  PRODUCTION_PACKAGE_REGENERATION, assertProductionApplyEnvironment, buildReviewedAnalysis, classifyExistingMigration, createOnlyWrites,
  makeDerekRecords, materializeAtApply, selectPortableRecords, sha256, validatePortableRecords, validateProductionIdentityState, verifyMigrationApproval,
} from "./engine.mjs";

const at = "2026-10-17T12:00:00.000Z";
function syntheticReviewedRecords() {
  const records = [];
  const add = (collection, id, fields) => records.push({ path: `${collection}/${id}`, fields: { status: "active", ...fields } });
  for (let i = 0; i < 15; i++) add(COLLECTIONS.app, `app-${i}`, { identityId: `authid:${i}`, appId: "integration-hub" });
  for (let i = 0; i < 51; i++) add(COLLECTIONS.site, `site-${i}`, { identityId: `authid:${i}`, oplocId: `oploc:${i}` });
  for (let i = 0; i < 41; i++) add(COLLECTIONS.grant, `grant-${i}`, { subjectType: "interactive", subjectId: `authid:${i}`, appId: "integration-hub", resource: "integration-hub.normal", action: "View", scope: { kind: "organisation", ids: [] } });
  add(COLLECTIONS.grant, "special-1", { subjectType: "interactive", subjectId: DEREK_IDENTITY, appId: "cpu-production", resource: "production.allergen-sign", action: "Approve", scope: { kind: "oploc", ids: ["oploc:rcoa"] } });
  add(COLLECTIONS.grant, "special-2", { subjectType: "interactive", subjectId: DEREK_IDENTITY, appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve", scope: { kind: "oploc", ids: ["oploc:rcoa"] } });
  add(COLLECTIONS.grant, "special-3", { subjectType: "interactive", subjectId: DEREK_IDENTITY, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:rcoa"] } });
  for (let i = 0; i < 10; i++) add(COLLECTIONS.custodian, `custodian-${i}`, { operationalIdentityId: "authid:operational-1", custodianLegendId: `legend-${i}` });
  for (const { path } of ANALYSIS_EXCLUSIONS) {
    const [collection, id] = path.split("/");
    const fields = collection === COLLECTIONS.app
      ? { identityId: DEREK_IDENTITY, appId: "integration-hub" }
      : { subjectType: "interactive", subjectId: DEREK_IDENTITY, appId: "integration-hub", resource: "authmod", action: "Administer", scope: { kind: "organisation", ids: [] } };
    add(collection, id, fields);
  }
  return records;
}

test("reviewed selector deterministically reconstructs 120 then excludes exactly three to 117", () => {
  const analysis = buildReviewedAnalysis({ sourceRecords: syntheticReviewedRecords(), asOf: at });
  assert.equal(analysis.records.length, 120);
  assert.equal(analysis.records.filter(value => value.path.startsWith(`${COLLECTIONS.app}/`)).length, 15);
  assert.equal(analysis.records.filter(value => value.path.startsWith(`${COLLECTIONS.site}/`)).length, 51);
  assert.equal(analysis.records.filter(value => value.path.startsWith(`${COLLECTIONS.grant}/`)).length, 44);
  assert.equal(analysis.records.filter(value => value.path.startsWith(`${COLLECTIONS.custodian}/`)).length, 10);
  const { portable, special } = selectPortableRecords(analysis.records);
  assert.equal(portable.length, 117);
  assert.equal(special.length, 3);
  assert.deepEqual(special.map(value => value.fields.resource).sort(), ["menu.publish", "production.allergen-final-approve", "production.allergen-sign"].sort());
  assert.equal(analysis.hash, buildReviewedAnalysis({ sourceRecords: syntheticReviewedRecords(), asOf: at }).hash);
  assert.ok(!portable.some(value => special.includes(value)));
});

test("fresh Derek records use governed production identifiers, scope, reason, and no Firebase binding", () => {
  const values = makeDerekRecords({ actorId: DEREK_IDENTITY, hubApplication: { appId: "integration-hub", enabled: true, standardActions: ["View"], standardResource: "integration-hub.normal" } });
  assert.equal(values.length, 3);
  assert.deepEqual(values.map(value => value.path).sort(), [
    `${COLLECTIONS.app}/production-authmod-v1:app-assignment:${DEREK_IDENTITY}:integration-hub`,
    `${COLLECTIONS.grant}/production-authmod-v1:authority:interactive:${DEREK_IDENTITY}:integration-hub:authmod:Administer:organisation`,
    `${COLLECTIONS.grant}/production-authmod-v1:grant:${DEREK_IDENTITY}:integration-hub:View`,
  ].sort());
  const admin = values.find(value => value.fields.action === "Administer").fields;
  assert.deepEqual(admin.scope, { kind: "organisation", ids: [] });
  assert.equal(admin.reason, APPROVED_ADMIN_REASON);
  assert.equal(admin.provenance, "explicit-special-authority");
  assert.ok(values.every(value => !("externalUid" in value.fields) && !("externalProvider" in value.fields)));
});

function savedPlan() {
  const body = {
    schema: "fika-authmod-production-migration.v1", mode: "create-only-production-authmod-policy-migration",
    sourceProject: "fika-os-dev", destinationProject: "fika-os", analysisAsOf: at, sourceStateHash: "source-1", sourceContext: { target: "fixed" },
    portableRecords: [{ path: "authmodSiteAssignments/site-1", fields: { status: "active" } }],
    freshProductionRecords: [], auditReceipt: { collection: "authmodAccessAudit", documentId: "migration-1", actorPrincipalId: DEREK_IDENTITY, actorPrincipalType: "interactive", timestamp: "$APPLY_TIMESTAMP", executableMigrationHash: "bound-to-complete-body-at-execution" },
  };
  return { body, planHash: sha256(body) };
}
const baseline = { identities: 19, applications: 7, policyDocuments: 0 };
const valid = { planHash: savedPlan().planHash, approvalHash: savedPlan().planHash, currentSourceStateHash: "source-1", currentSourceContext: { target: "fixed" }, destination: baseline };

test("saved executable body must match plan, CLI approval and explicit environment approval", () => {
  const plan = savedPlan();
  assert.equal(verifyMigrationApproval(plan, { ...valid, planHash: plan.planHash, approvalHash: plan.planHash }), plan.planHash);
  for (const changed of [
    { ...plan, body: { ...plan.body, portableRecords: [{ path: "authmodSiteAssignments/other", fields: {} }] } },
    { ...plan, body: { ...plan.body, freshProductionRecords: [{ path: "authmodAuthorityGrants/new", fields: {} }] } },
    { ...plan, body: { ...plan.body, exclusions: [{ path: "booking/secret", reason: "changed" }] } },
    { ...plan, body: { ...plan.body, destinationProject: "fika-os-dev" } },
  ]) assert.throws(() => verifyMigrationApproval(changed, { ...valid, planHash: plan.planHash, approvalHash: plan.planHash }));
  assert.throws(() => verifyMigrationApproval(plan, { ...valid, approvalHash: "wrong" }), /all three approval hashes/);
  assert.throws(() => verifyMigrationApproval(plan, { ...valid, currentSourceStateHash: "drift" }), /source drift/);
  assert.throws(() => verifyMigrationApproval(plan, { ...valid, currentSourceContext: { target: "changed" } }), /context drift/);
});

test("an approved source record that expires before apply fails closed", () => {
  const plan = savedPlan();
  plan.body.portableRecords[0].fields.effectiveTo = "2026-10-16T00:00:00.000Z";
  plan.planHash = sha256(plan.body);
  assert.throws(() => verifyMigrationApproval(plan, { ...valid, planHash: plan.planHash, approvalHash: plan.planHash, verificationTime: at }), /no longer effective/);
});

test("production apply is explicitly scoped and create-only writes include audit receipt", () => {
  assert.doesNotThrow(() => assertProductionApplyEnvironment({ runtimeMode: "production", sourceProject: "fika-os-dev", destinationProject: "fika-os" }));
  assert.throws(() => assertProductionApplyEnvironment({ runtimeMode: "staging", sourceProject: "fika-os-dev", destinationProject: "fika-os" }));
  assert.throws(() => assertProductionApplyEnvironment({ runtimeMode: "production", sourceProject: "fika-os-dev", destinationProject: "fika-os-dev" }));
  const plan = savedPlan();
  const writes = createOnlyWrites(plan, "migration-actor", at);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(value => value.currentDocument.exists === false));
  assert.equal(writes.at(-1).path, "authmodAccessAudit/migration-1");
  assert.equal(writes.at(-1).fields.executableMigrationHash, plan.planHash);
  assert.equal(writes.at(-1).fields.timestamp, at);
  assert.equal(writes.at(-1).fields.actorPrincipalType, "interactive");
  assert.equal(materializeAtApply("$APPLY_TIMESTAMP", at), at);
});

test("production policy baseline must remain empty before first apply", () => {
  const plan = savedPlan();
  assert.throws(() => verifyMigrationApproval(plan, { ...valid, planHash: plan.planHash, approvalHash: plan.planHash, destination: { ...baseline, policyDocuments: 1 } }), /baseline/);
});

test("portable records reject staging UID/email/fullAccess fields and package rebuild is production-derived", () => {
  const references = { identities: ["authid:1"], applications: ["integration-hub"], oplocs: ["oploc:1"], legends: ["legend:1"] };
  const good = [{ path: "authmodSiteAssignments/site-1", fields: { status: "active", identityId: "authid:1", oplocId: "oploc:1" } }];
  assert.doesNotThrow(() => validatePortableRecords(good, references));
  for (const field of [{ externalUid: "staging-uid" }, { normalizedEmail: "person@example.com" }, { fullAccess: true }]) {
    assert.throws(() => validatePortableRecords([{ ...good[0], fields: { ...good[0].fields, ...field } }], references));
  }
  assert.deepEqual(PRODUCTION_PACKAGE_REGENERATION, {
    required: true, sourceProject: "fika-os", function: "bootstrapActiveAuthmodAccessPackages",
    identities: "active production identities", executeInMigration: false, stagingManifestsCopied: false,
  });
});

test("production identity baseline keeps every fullAccess false and Derek unbound", () => {
  const identities = Array.from({ length: 19 }, (_, i) => ({ id: `authid:${i}`, fullAccess: false }));
  const derek = { id: DEREK_IDENTITY, identityKind: "person", status: "active", fullAccess: false };
  identities[0] = derek;
  assert.equal(validateProductionIdentityState({ allIdentities: identities, derekIdentity: derek }), derek);
  assert.throws(() => validateProductionIdentityState({ allIdentities: [...identities.slice(1), { ...derek, fullAccess: true }], derekIdentity: derek }), /fullAccess=false/);
  assert.throws(() => validateProductionIdentityState({ allIdentities: identities, derekIdentity: { ...derek, externalUid: "staging" } }), /unbound/);
});

test("migration retry is no-op only for complete exact target plus matching receipt", () => {
  const expectedRecords = [{ path: "authmodSiteAssignments/site-1", fields: { status: "active" } }];
  const receipt = { fields: { executableMigrationHash: "plan-1", sourceStateHash: "source-1" } };
  assert.equal(classifyExistingMigration({ existingPolicy: [], expectedRecords, receipt: undefined, expectedReceipt: undefined, planHash: "plan-1", sourceStateHash: "source-1" }), "empty-baseline");
  assert.equal(classifyExistingMigration({ existingPolicy: expectedRecords, expectedRecords, receipt, expectedReceipt: receipt.fields, planHash: "plan-1", sourceStateHash: "source-1" }), "already-applied-exactly");
  assert.throws(() => classifyExistingMigration({ existingPolicy: expectedRecords, expectedRecords, receipt: { fields: { executableMigrationHash: "other", sourceStateHash: "source-1" } }, expectedReceipt: receipt.fields, planHash: "plan-1", sourceStateHash: "source-1" }), /partially populated/);
  assert.throws(() => classifyExistingMigration({ existingPolicy: [{ ...expectedRecords[0], fields: { status: "revoked" } }], expectedRecords, receipt, expectedReceipt: receipt.fields, planHash: "plan-1", sourceStateHash: "source-1" }), /partially populated/);
});
