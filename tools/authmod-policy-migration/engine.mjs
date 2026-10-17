import { createHash } from "node:crypto";

export const SOURCE_PROJECT = "fika-os-dev";
export const DESTINATION_PROJECT = "fika-os";
export const ANALYSIS_HASH_APPROVED = "05a47e105323a0bc081d2f625d3725a17a9d2063eb9a03db84913097a834d51e";
export const DEREK_IDENTITY = "authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7";
export const COLLECTIONS = Object.freeze({
  app: "authmodAppAssignments",
  site: "authmodSiteAssignments",
  grant: "authmodAuthorityGrants",
  custodian: "authmodCustodianAssignments",
});
export const SPECIAL_GRANT_KEYS = Object.freeze([
  { appId: "cpu-production", resource: "production.allergen-sign", action: "Approve" },
  { appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve" },
  { appId: "menu-planning", resource: "menu.publish", action: "Publish" },
]);

// These five staging/UAT records were explicitly excluded from the reviewed 120.
export const ANALYSIS_EXCLUSIONS = Object.freeze([
  { path: `${COLLECTIONS.app}/app-assignment:${DEREK_IDENTITY}:integration-hub`, reason: "staging-alpha-only Integration Hub app access" },
  { path: `${COLLECTIONS.grant}/authority:interactive:${DEREK_IDENTITY}:integration-hub:authmod:Administer:organisation`, reason: "staging-alpha bootstrap Administer grant; production intent not established" },
  { path: `${COLLECTIONS.grant}/grant:${DEREK_IDENTITY}:integration-hub:View`, reason: "paired staging-alpha Hub standard grant" },
  { path: `${COLLECTIONS.grant}/authority:interactive:${DEREK_IDENTITY}:logistics:logistics-vehicle:View:resource:van1`, reason: "staging UAT vehicle-view grant" },
  { path: `${COLLECTIONS.grant}/authority:interactive:${DEREK_IDENTITY}:logistics:logistics-vehicle:View:resource:van2`, reason: "staging UAT vehicle-view grant" },
]);
export const APPROVED_ADMIN_REASON = "Initial production AUTHMOD administrator — explicitly approved for production cutover";
export const APPLY_TIMESTAMP = "$APPLY_TIMESTAMP";
export const PRODUCTION_PACKAGE_REGENERATION = Object.freeze({
  required: true,
  sourceProject: DESTINATION_PROJECT,
  function: "bootstrapActiveAuthmodAccessPackages",
  identities: "active production identities",
  executeInMigration: false,
  stagingManifestsCopied: false,
});
const SPECIAL_EXCLUSION_REASON = "explicitly deferred by approved production AUTHMOD policy decision";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}
export function isEffective(record, at) {
  if (record.status !== "active") return false;
  const millis = new Date(at).getTime();
  return (!record.effectiveFrom || Date.parse(record.effectiveFrom) <= millis) && (!record.effectiveTo || Date.parse(record.effectiveTo) > millis);
}
const sortRecords = records => [...records].sort((a, b) => a.path.localeCompare(b.path));
const collectionFor = path => path.split("/")[0];
const selectedRecord = record => isEffective(record.fields, record.analysisTime);
const specialKey = fields => SPECIAL_GRANT_KEYS.some(value => value.appId === fields.appId && value.resource === fields.resource && value.action === fields.action);

export function buildReviewedAnalysis({ sourceRecords, asOf }) {
  const active = sortRecords(sourceRecords.filter(record => COLLECTIONS && Object.values(COLLECTIONS).includes(collectionFor(record.path)) && isEffective(record.fields, asOf)));
  const excludedPaths = new Set(ANALYSIS_EXCLUSIONS.map(value => value.path));
  const candidates = active.filter(record => !excludedPaths.has(record.path));
  const body = {
    schema: "fika-authmod-policy-delta.v1",
    sourceProject: SOURCE_PROJECT,
    targetProject: DESTINATION_PROJECT,
    selection: { status: "active-and-effective-at-analysis-time", collections: Object.values(COLLECTIONS) },
    excludedPaths: ANALYSIS_EXCLUSIONS,
    records: candidates.map(({ path, fields }) => ({ path, fields })),
  };
  return { body, hash: sha256(body), records: candidates };
}

export function makeDerekRecords({ actorId, hubApplication }) {
  if (!hubApplication || hubApplication.appId !== "integration-hub" || hubApplication.enabled !== true || !Array.isArray(hubApplication.standardActions) || hubApplication.standardActions.length !== 1 || hubApplication.standardActions[0] !== "View" || !hubApplication.standardResource) throw new Error("Production Integration Hub definition must be enabled with its current single View standard grant.");
  const timestamp = APPLY_TIMESTAMP;
  const bundleId = `production-authmod-v1:standard-app-access:${DEREK_IDENTITY}:integration-hub`;
  const assignment = {
    id: `production-authmod-v1:app-assignment:${DEREK_IDENTITY}:integration-hub`, identityId: DEREK_IDENTITY, appId: "integration-hub",
    status: "active", bundleId, source: "standard-app-access", accessType: "permanent",
    reason: "Production Integration Hub access approved for initial AUTHMOD administration.", grantedBy: actorId,
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  const viewGrant = {
    id: `production-authmod-v1:grant:${DEREK_IDENTITY}:integration-hub:View`, subjectType: "interactive", subjectId: DEREK_IDENTITY,
    appId: "integration-hub", resource: hubApplication.standardResource, action: "View", scope: { kind: "organisation", ids: [] },
    status: "active", provenance: "standard-app-access", bundleId, accessType: "permanent",
    reason: "Production Integration Hub access approved for initial AUTHMOD administration.", grantedBy: actorId,
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  const adminGrant = {
    id: `production-authmod-v1:authority:interactive:${DEREK_IDENTITY}:integration-hub:authmod:Administer:organisation`,
    subjectType: "interactive", subjectId: DEREK_IDENTITY, appId: "integration-hub", resource: "authmod", action: "Administer",
    scope: { kind: "organisation", ids: [] }, status: "active", provenance: "explicit-special-authority",
    reason: APPROVED_ADMIN_REASON, grantedBy: actorId, version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  return [
    { path: `${COLLECTIONS.app}/${assignment.id}`, fields: assignment },
    { path: `${COLLECTIONS.grant}/${viewGrant.id}`, fields: viewGrant },
    { path: `${COLLECTIONS.grant}/${adminGrant.id}`, fields: adminGrant },
  ];
}
export function selectPortableRecords(analysisRecords) {
  const special = analysisRecords.filter(record => collectionFor(record.path) === COLLECTIONS.grant && specialKey(record.fields));
  if (special.length !== 3 || new Set(special.map(record => `${record.fields.appId}|${record.fields.resource}|${record.fields.action}`)).size !== 3) throw new Error(`Expected exactly the three approved legacy grants; found ${special.length}.`);
  const specialPaths = new Set(special.map(record => record.path));
  const portable = analysisRecords.filter(record => !specialPaths.has(record.path));
  if (portable.length !== 117) throw new Error(`Expected 117 portable records; found ${portable.length}.`);
  return { portable, special };
}

export function buildMigrationPlan({ sourceRecords, productionReferences, asOf, actorId, sourceContext = {} }) {
  const analysis = buildReviewedAnalysis({ sourceRecords, asOf });
  if (analysis.hash !== ANALYSIS_HASH_APPROVED) throw new Error(`Reviewed 120-record analysis hash mismatch: expected ${ANALYSIS_HASH_APPROVED}, received ${analysis.hash}.`);
  if (analysis.records.length !== 120) throw new Error(`Expected reviewed 120-record candidate; found ${analysis.records.length}.`);
  const { portable, special } = selectPortableRecords(analysis.records);
  validatePortableRecords(portable, productionReferences);
  const derek = validateProductionIdentityState(productionReferences);
  const hubApplication = productionReferences.applicationDefinitions.find(value => value.appId === "integration-hub");
  const freshDerek = makeDerekRecords({ actorId, hubApplication });
  const targets = sortRecords([...portable.map(({ path, fields }) => ({ path, fields })), ...freshDerek]);
  if (targets.length !== 120 || new Set(targets.map(value => value.path)).size !== targets.length) throw new Error("Executable target set is not exactly 120 unique policy documents.");
  const sourceState = sortRecords(sourceRecords.map(({ path, fields, updateTime = null }) => ({ path, fields, updateTime })));
  const sourceStateHash = sha256(sourceState);
  const body = {
    schema: "fika-authmod-production-migration.v1",
    mode: "create-only-production-authmod-policy-migration",
    sourceProject: SOURCE_PROJECT,
    destinationProject: DESTINATION_PROJECT,
    analysisAsOf: asOf,
    sourceAnalysisHash: analysis.hash,
    sourceStateHash,
    sourceContext,
    targetBaseline: { authmodIdentities: 19, authmodApplications: 7, policyDocuments: 0 },
    portableRecordCount: portable.length,
    portableRecords: portable.map(({ path, fields }) => ({ path, fields })),
    exclusions: [
      ...ANALYSIS_EXCLUSIONS.map(value => ({ ...value, category: "staging-or-uat-only" })),
      ...special.map(({ path, fields }) => ({ path, reason: SPECIAL_EXCLUSION_REASON, category: "approved-deferred-special-authority", appId: fields.appId, resource: fields.resource, action: fields.action })),
    ],
    freshProductionRecords: freshDerek,
    expectedProductionRecordCountAfter: targets.length,
    auditReceipt: {
      collection: "authmodAccessAudit",
      documentId: `production-authmod-policy-migration-${sourceStateHash.slice(0, 20)}`,
      eventType: "production-authmod-policy-migration",
      migrationId: `production-authmod-policy-migration-${sourceStateHash.slice(0, 20)}`,
      actorPrincipalId: DEREK_IDENTITY,
      actorPrincipalType: "interactive",
      actorSnapshot: { displayName: String(derek.displayName || "Derek") },
      targetType: "AUTHMODPolicyMigration",
      targetId: `production-authmod-policy-migration-${sourceStateHash.slice(0, 20)}`,
      action: "production-policy-migrated",
      scope: { kind: "organisation", ids: [] },
      provenance: "migration",
      outcome: "committed",
      businessDecision: "SOL-approved AUTHMOD policy migration; 117 portable records plus explicitly approved fresh Derek production enrollment records.",
      approvingIdentityId: DEREK_IDENTITY,
      executedBy: sourceContext.executionOperatorEmail || actorId,
      sourceProject: SOURCE_PROJECT,
      sourceSelector: "active-and-effective authmodAppAssignments, authmodSiteAssignments, authmodAuthorityGrants, authmodCustodianAssignments, less five reviewed staging/UAT records and three deferred Derek grants",
      sourceAnalysisHash: analysis.hash,
      sourceStateHash,
      portableRecordCount: portable.length,
      excludedSpecialGrants: special.map(({ path, fields }) => ({ path, appId: fields.appId, resource: fields.resource, action: fields.action })),
      freshDerekRecordPaths: freshDerek.map(value => value.path),
      executableMigrationHash: "bound-to-complete-body-at-execution",
      timestamp: APPLY_TIMESTAMP,
    },
    postApply: { regenerateAccessPackages: PRODUCTION_PACKAGE_REGENERATION },
  };
  return { body, planHash: sha256(body), analysisHash: analysis.hash, sourceStateHash, portable, special, freshDerek, targets };
}

export function validateProductionIdentityState(references) {
  const derek = references.derekIdentity;
  if (!derek || derek.id !== DEREK_IDENTITY || derek.identityKind !== "person" || derek.status !== "active" || derek.fullAccess !== false || derek.externalUid || derek.externalProvider) throw new Error("Derek's production identity must be active, person-kind, unbound, and fullAccess=false.");
  if (!Array.isArray(references.allIdentities) || references.allIdentities.length !== 19 || references.allIdentities.some(identity => identity.fullAccess !== false)) throw new Error("Production identity baseline must contain 19 identities, all with fullAccess=false.");
  return derek;
}

export function validatePortableRecords(records, references) {
  const identities = new Set(references.identities);
  const apps = new Set(references.applications);
  const oplocs = new Set(references.oplocs);
  const legends = new Set(references.legends);
  const forbiddenKeys = new Set(["externaluid", "externalprovider", "firebaseuid", "sessionid", "normalizedemail", "email"]);
  const scanForbidden = (value, path) => {
    if (Array.isArray(value)) { for (const child of value) scanForbidden(child, path); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase()) || key.toLowerCase().includes("session")) throw new Error(`Environment-bound field ${key} appears in policy record ${path}.`);
      if (key === "fullAccess" && child === true) throw new Error(`fullAccess=true appears in policy record ${path}.`);
      scanForbidden(child, path);
    }
  };
  for (const record of records) {
    const f = record.fields;
    scanForbidden(f, record.path);
    if (f.status !== "active") throw new Error(`Non-active policy selected at ${record.path}.`);
    const identityId = f.identityId || f.subjectId || f.operationalIdentityId;
    if (!identityId || !identities.has(identityId)) throw new Error(`Policy record ${record.path} does not reference a production canonical identity.`);
    if (f.subjectType && f.subjectType !== "interactive") throw new Error(`Non-person policy principal is not portable: ${record.path}.`);
    if (f.appId && !apps.has(f.appId)) throw new Error(`Policy record ${record.path} references an unknown production app ${f.appId}.`);
    if (f.oplocId && !oplocs.has(f.oplocId)) throw new Error(`Policy record ${record.path} references an unknown production OPLOC ${f.oplocId}.`);
    if (f.legendId && !legends.has(f.legendId)) throw new Error(`Policy record ${record.path} references an unknown production Legend ${f.legendId}.`);
    if (f.custodianLegendId && !legends.has(f.custodianLegendId)) throw new Error(`Policy record ${record.path} references an unknown production custodian Legend ${f.custodianLegendId}.`);
    if (f.operationalIdentityId && !identities.has(f.operationalIdentityId)) throw new Error(`Policy record ${record.path} references an unknown production operational identity.`);
    if (f.scope?.kind === "oploc" && (f.scope.ids || []).some(id => !oplocs.has(id))) throw new Error(`Policy record ${record.path} has a scope OPLOC missing in production.`);
  }
}

export function verifyMigrationApproval(savedPlan, { planHash, approvalHash, currentSourceStateHash, currentSourceContext, destination, verificationTime = new Date().toISOString() }) {
  if (!savedPlan?.body || !savedPlan?.planHash) throw new Error("Saved executable migration plan is malformed.");
  const computed = sha256(savedPlan.body);
  if (computed !== savedPlan.planHash || computed !== planHash || computed !== approvalHash) throw new Error("Executable migration body is not bound to all three approval hashes.");
  if (savedPlan.body.schema !== "fika-authmod-production-migration.v1" || savedPlan.body.mode !== "create-only-production-authmod-policy-migration" || savedPlan.body.sourceProject !== SOURCE_PROJECT || savedPlan.body.destinationProject !== DESTINATION_PROJECT) throw new Error("Migration project/runtime scope is not the approved production migration.");
  if (savedPlan.body.sourceStateHash !== currentSourceStateHash) throw new Error("Staging AUTHMOD source drift detected; refusing production apply.");
  if (!currentSourceContext || sha256(savedPlan.body.sourceContext) !== sha256(currentSourceContext)) throw new Error("Production AUTHMOD identity/application/reference context drift detected; refusing apply.");
  if (!Array.isArray(savedPlan.body.portableRecords) || savedPlan.body.portableRecords.some(record => !isEffective(record.fields, verificationTime))) throw new Error("At least one approved portable policy record is no longer effective; regenerate and reapprove the migration.");
  if (destination.identities !== 19 || destination.applications !== 7 || destination.policyDocuments !== 0) throw new Error("Production AUTHMOD destination baseline differs from the approved empty-policy baseline.");
  return computed;
}

export function assertProductionApplyEnvironment({ runtimeMode, sourceProject, destinationProject }) {
  if (runtimeMode !== "production" || sourceProject !== SOURCE_PROJECT || destinationProject !== DESTINATION_PROJECT) throw new Error("AUTHMOD migration apply is restricted to production runtime, fika-os-dev source, and fika-os destination.");
}

export function materializeAtApply(value, timestamp) {
  if (Array.isArray(value)) return value.map(child => materializeAtApply(child, timestamp));
  if (value === APPLY_TIMESTAMP) return timestamp;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materializeAtApply(child, timestamp)]));
  return value;
}

export function createOnlyWrites(plan, actorId, operationTimestamp = new Date().toISOString()) {
  const receipt = materializeAtApply({ ...plan.body.auditReceipt, executableMigrationHash: plan.planHash, actorPrincipalId: plan.body.auditReceipt.actorPrincipalId, actorPrincipalType: plan.body.auditReceipt.actorPrincipalType, executedBy: actorId }, operationTimestamp);
  return [
    ...materializeAtApply(plan.body.portableRecords, operationTimestamp),
    ...materializeAtApply(plan.body.freshProductionRecords, operationTimestamp),
    { path: `${plan.body.auditReceipt.collection}/${plan.body.auditReceipt.documentId}`, fields: receipt },
  ].map(({ path, fields }) => ({ path, fields, currentDocument: { exists: false } }));
}

export function classifyExistingMigration({ existingPolicy, expectedRecords, receipt, expectedReceipt, planHash, sourceStateHash }) {
  if (!existingPolicy.length && !receipt) return "empty-baseline";
  const byPath = new Map(existingPolicy.map(value => [value.path, value.fields]));
  const exactPolicy = byPath.size === expectedRecords.length && expectedRecords.every(value => byPath.has(value.path) && sha256(byPath.get(value.path)) === sha256(value.fields));
  const exactReceipt = receipt && expectedReceipt && sha256(receipt.fields) === sha256(expectedReceipt) && receipt.fields.executableMigrationHash === planHash && receipt.fields.sourceStateHash === sourceStateHash;
  if (exactPolicy && exactReceipt) return "already-applied-exactly";
  throw new Error("Production AUTHMOD policy is non-empty or partially populated; refusing apply/retry without exact completed migration state.");
}
