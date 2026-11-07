import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { AuthIdentity, AuthPrincipal, ApplicationRegistryEntry } from "../lib/authmod-core/model";

const enabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os"
  && /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")
  && (process.env.FIKA_RUNTIME_MODE || "local") === "local";

test("emulator: app-access HTTP save/revoke commits atomically, fences caches and reports package failure truthfully", { skip: !enabled }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "authmod-app-access-"));
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("authmod-app-access-"));
    await rm(root, { recursive: true, force: true });
  });
  const { db } = await import("../lib/firebase-admin");
  const { FirestoreAuthModRepository } = await import("../lib/authmod-core/firestore-repository");
  const { handleAccountAction } = await import("../app/api/authmod/accounts/[id]/actions/handler");
  const { POST } = await import("../app/api/authmod/accounts/[id]/actions/route");
  const { bootstrapAuthmodAccessPackage, getAuthmodAccessReadPackage, readAuthmodAccessHead } = await import("../lib/authmod-access-read-package");
  const { rebuildAuthmodReferenceReadPackage } = await import("../lib/authmod-reference-read-package");
  const { cachedAuthmodReference } = await import("../lib/authmod-reference-cache");
  const { cachedAuthmodAdmission, authmodAdmissionCacheConfigForTests } = await import("../lib/authmod-admission-cache");
  const { evaluateAuthority } = await import("../lib/authmod-core/evaluator");
  const id = `identity:app-access:${randomUUID()}`;
  const appId = `app-access-test-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  const identity: AuthIdentity = { id, displayName: "Synthetic app-access account", identityKind: "person", identityLinkStatus: "matched", status: "active", fullAccess: false, provenance: "system", version: 1, createdAt: timestamp, updatedAt: timestamp };
  const app: ApplicationRegistryEntry = { appId, displayName: "Synthetic application", enabled: true, launchVisible: false, scopeModel: "none", standardBundleId: `bundle:${appId}`, standardResource: appId, standardActions: ["View", "Manage"], version: 1, provenance: "system", createdAt: timestamp, updatedAt: timestamp };
  const principal: AuthPrincipal = { type: "interactive", id: "synthetic-admin", displayName: "Synthetic test administrator", identityKind: "person" };
  await db.collection("authmodIdentities").doc(id).set(identity);
  await db.collection("authmodApplications").doc(appId).set(app);
  await rebuildAuthmodReferenceReadPackage();
  await bootstrapAuthmodAccessPackage(id);
  const headBefore = await readAuthmodAccessHead(id);
  let publicationCalls = 0;
  const repository = new FirestoreAuthModRepository(`test:${id}`, async () => { publicationCalls++; throw Error("synthetic package storage outage"); });
  const request = (body: object) => new NextRequest(`http://localhost/api/authmod/accounts/${id}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const params = { params: Promise.resolve({ id }) };
  const invoke = (body: object, repo = repository) => handleAccountAction(request(body), params, async () => ({ principal, repository: repo }));
  const command = { action: "app", appId, enabled: true, expectedVersion: 1, reasonCode: "role_requirement" };
  const cached = { identityId: id, appId, load: async () => ({ allowed: true }) };
  await cachedAuthmodAdmission(cached);
  let referenceLoads = 0;
  const reference = () => cachedAuthmodReference({ scope: id, name: "test", documents: () => 1, load: async () => ++referenceLoads });
  await reference();
  const generationBefore = authmodAdmissionCacheConfigForTests().generation;

  const granted = await invoke(command);
  assert.equal(granted.status, 200);
  assert.equal(granted.headers.get("cache-control"), "no-store");
  const grantedBody = await granted.json();
  assert.equal(grantedBody.committed, true);
  assert.match(grantedBody.warning, /saved.*Do not repeat/);
  assert.ok(grantedBody.account.apps.some((app: { id: string }) => app.id === appId));
  assert.equal(publicationCalls, 1);
  assert.ok(await readAuthmodAccessHead(id) > headBefore);
  assert.ok(authmodAdmissionCacheConfigForTests().generation > generationBefore);
  assert.equal(await reference(), 2);
  assert.equal((await cachedAuthmodAdmission({ ...cached, load: async () => ({ allowed: false }) })).allowed, false);
  const assignments = await repository.listAppAssignments(id);
  const grants = await repository.listAuthorityGrants(id, "interactive");
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].status, "active");
  assert.equal(grants.length, 2);
  assert.equal((await db.collection("authmodAccessAudit").where("targetId", "==", assignments[0].id).get()).size, 1);
  await assert.rejects(getAuthmodAccessReadPackage(id), { code: "AUTHMOD_ACCESS_PACKAGE_STALE" });
  assert.equal((await evaluateAuthority(repository, { principal: { ...principal, id }, appId, resource: appId, action: "View", scope: { kind: "organisation", ids: [] } })).allowed, false);

  const rejected = await invoke({ ...command, expectedVersion: 99 });
  assert.equal(rejected.status, 409);
  assert.equal(publicationCalls, 1);
  await assert.rejects(repository.saveStandardApplicationBundle({ assignment: assignments[0], grants, expectedAssignmentVersion: 0 }), /changed/i);
  assert.equal(publicationCalls, 1);
  assert.equal((await repository.listAppAssignments(id))[0].version, 1);
  assert.equal((await POST(request(command), params)).status, 401);

  await bootstrapAuthmodAccessPackage(id);
  assert.equal((await getAuthmodAccessReadPackage(id)).appAssignments[0].status, "active");
  const revoked = await invoke({ ...command, enabled: false });
  assert.equal(revoked.status, 200);
  const revokedBody = await revoked.json();
  assert.equal(revokedBody.committed, true);
  assert.ok(!revokedBody.account.apps.some((app: { id: string }) => app.id === appId));
  assert.equal((await repository.listAppAssignments(id))[0].status, "revoked");
  assert.ok((await repository.listAuthorityGrants(id, "interactive")).every(grant => grant.status === "revoked"));
  await assert.rejects(getAuthmodAccessReadPackage(id), { code: "AUTHMOD_ACCESS_PACKAGE_STALE" });
  assert.equal((await db.collection("authmodAccessAudit").where("targetId", "==", assignments[0].id).get()).size, 2);
  await bootstrapAuthmodAccessPackage(id);
  const working = new FirestoreAuthModRepository(`success:${id}`);
  const saved = await invoke(command, working);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).warning, undefined);
  assert.equal((await getAuthmodAccessReadPackage(id)).appAssignments[0].status, "active");

  const refreshFailure = new FirestoreAuthModRepository(`refresh-failure:${id}`, async () => { throw Error("synthetic package outage"); });
  refreshFailure.listApplications = async () => { throw Error("synthetic reference-package outage"); };
  const savedWithoutRefresh = await invoke({ ...command, enabled: false }, refreshFailure);
  assert.equal(savedWithoutRefresh.status, 200);
  const withoutRefresh = await savedWithoutRefresh.json();
  assert.equal(withoutRefresh.committed, true);
  assert.equal(withoutRefresh.account, undefined);
  assert.match(withoutRefresh.warning, /saved.*Do not repeat/);
  assert.equal((await repository.listAppAssignments(id))[0].status, "revoked");
  const successfulRefreshFailure = new FirestoreAuthModRepository(`refresh-only:${id}`);
  successfulRefreshFailure.listApplications = refreshFailure.listApplications;
  const savedWithOnlyRefreshFailure = await invoke(command, successfulRefreshFailure);
  assert.equal(savedWithOnlyRefreshFailure.status, 200);
  assert.match((await savedWithOnlyRefreshFailure.json()).warning, /saved.*account display.*Do not repeat/);

  await db.collection("authmodIdentities").doc(id).update({ status: "inactive" });
  const inactive = await invoke({ ...command, enabled: false }, working);
  assert.equal(inactive.status, 200);
  assert.equal((await inactive.json()).warning, undefined);
  assert.equal((await working.listAppAssignments(id))[0].status, "revoked");
  assert.equal((await evaluateAuthority(working, { principal: { ...principal, id }, appId, resource: appId, action: "View", scope: { kind: "organisation", ids: [] } })).allowed, false);
});

test("emulator: the AUTHMOD account command persists one audited Beverage View grant for a full explicit site inventory", { skip: !enabled }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "authmod-beverage-sites-"));
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("authmod-beverage-sites-"));
    await rm(root, { recursive: true, force: true });
  });
  const { db } = await import("../lib/firebase-admin");
  const { FirestoreAuthModRepository } = await import("../lib/authmod-core/firestore-repository");
  const { handleAccountAction } = await import("../app/api/authmod/accounts/[id]/actions/handler");
  const { getAuthmodAccessReadPackage, readAuthmodAccessHead } = await import("../lib/authmod-access-read-package");
  const { rebuildAuthmodReferenceReadPackage } = await import("../lib/authmod-reference-read-package");
  const { canonicalDocumentId } = await import("../lib/canonical-oplocs");
  const {
    BEVERAGE_AUTHMOD_APP_ID: appId, BEVERAGE_AUTHMOD_NORMAL_BUNDLE: standardBundleId,
    BEVERAGE_AUTHMOD_NORMAL_RESOURCE: resource, MAX_BEVERAGE_OPLOC_SCOPE,
  } = await import("../lib/authmod-core/beverage-admission");
  const fixture = randomUUID();
  const id = `identity:fixture:${fixture}`;
  const timestamp = new Date().toISOString();
  const identity: AuthIdentity = {
    id, displayName: "Fixture Beverage reviewer", externalProvider: "firebase", externalUid: `firebase-fixture:${fixture}`,
    identityKind: "person", identityLinkStatus: "matched", status: "active", fullAccess: false, provenance: "system",
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  const app: ApplicationRegistryEntry = {
    appId, displayName: "Fixture Beverage", enabled: true, launchVisible: false, scopeModel: "oploc",
    standardBundleId, standardResource: resource, standardActions: ["View"], version: 1, provenance: "system",
    createdAt: timestamp, updatedAt: timestamp,
  };
  const ids = Array.from({ length: MAX_BEVERAGE_OPLOC_SCOPE }, (_, index) =>
    `oploc:fixture:${fixture}:${String(index).padStart(3, "0")}:${"x".repeat(100)}`);
  const batch = db.batch();
  batch.set(db.collection("authmodIdentities").doc(id), identity);
  batch.set(db.collection("authmodApplications").doc(appId), app);
  for (const canonicalId of ids) {
    batch.set(db.collection("integrationHubCanonical").doc(canonicalDocumentId(canonicalId)), {
      canonicalId, entityType: "OPLOC", lifecycleStatus: "active", publicationStatus: "current",
      record: { lifecycleState: "active", approvedName: "Fixture Beverage site" },
    });
  }
  await batch.commit();
  t.after(async () => {
    const cleanup = db.batch();
    cleanup.delete(db.collection("authmodApplications").doc(appId));
    for (const canonicalId of ids) cleanup.delete(db.collection("integrationHubCanonical").doc(canonicalDocumentId(canonicalId)));
    await cleanup.commit();
  });
  await rebuildAuthmodReferenceReadPackage();
  const repository = new FirestoreAuthModRepository(`fixture:${fixture}`);
  const principal: AuthPrincipal = { type: "interactive", id: "fixture:authmod-admin", displayName: "Fixture administrator" };
  const invoke = (body: object) => handleAccountAction(
    new NextRequest(`http://localhost/api/authmod/accounts/${id}/actions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
    async () => ({ principal, repository }),
  );
  const common = { appId, expectedVersion: 1, reason: "Fictional owner-approved staging View scope." };
  const command = { ...common, action: "authority-grant", resource, authorityAction: "View", scope: { kind: "oploc", ids: [...ids].reverse() } };
  assert.equal((await invoke(command)).status, 422);
  assert.equal((await invoke({ ...common, action: "app", enabled: true })).status, 200);
  const admissionHead = await readAuthmodAccessHead(id);
  assert.equal((await invoke({ ...command, expectedVersion: 99 })).status, 409);
  assert.equal((await invoke({ ...command, scope: { kind: "oploc", ids: [...ids, "oploc:fixture-extra"] } })).status, 400);
  assert.equal((await invoke({ ...command, authorityAction: "Manage" })).status, 422);
  assert.equal(await readAuthmodAccessHead(id), admissionHead);

  const response = await invoke(command);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).warning, undefined);
  assert.ok(await readAuthmodAccessHead(id) > admissionHead);
  const access = await getAuthmodAccessReadPackage(id);
  assert.deepEqual(access.siteAssignments, []);
  assert.equal(access.authorityGrants.length, 2);
  const [grant] = access.authorityGrants.filter(candidate => candidate.provenance === "explicit-special-authority");
  assert.match(grant.id, /^authority:beverage:[a-f0-9]{64}$/);
  assert.deepEqual(grant.scope, { kind: "oploc", ids });
  const audit = await db.collection("authmodAccessAudit").where("targetId", "==", grant.id).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].get("actorPrincipalId"), principal.id);
  assert.deepEqual(audit.docs[0].get("scope"), grant.scope);
});

test("emulator: create the hidden Beverage registry and audit atomically without changing grants or other application authority", { skip: !enabled }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "authmod-beverage-registry-"));
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("authmod-beverage-registry-"));
    await rm(root, { recursive: true, force: true });
  });
  const { db } = await import("../lib/firebase-admin");
  const { getAuthmodReferenceManifest, getAuthmodReferenceReadPackage, rebuildAuthmodReferenceReadPackage } =
    await import("../lib/authmod-reference-read-package");
  const { provisionBeverageStagingRegistry, publishBeverageRegistryReferences } = await import("../lib/beverage-staging-registry");
  const { BEVERAGE_AUTHMOD_APP_ID: appId, decideBeverageSiteAuthority } = await import("../lib/authmod-core/beverage-admission");
  const { idempotentId } = await import("../lib/authmod-core/model");
  const { FirestoreAuthModRepository } = await import("../lib/authmod-core/firestore-repository");
  const { evaluateAuthority } = await import("../lib/authmod-core/evaluator");
  const fixture = randomUUID();
  const id = `identity:registry-operator:${fixture}`;
  const operator = { uid: `fixture:${fixture}`, email: "operator@example.test" };
  const timestamp = new Date().toISOString();
  const identity: AuthIdentity = {
    id, displayName: "Fixture registry operator", externalProvider: "firebase", externalUid: operator.uid, normalizedEmail: operator.email,
    identityKind: "person", identityLinkStatus: "matched", status: "active", fullAccess: true,
    version: 1, createdAt: timestamp, updatedAt: timestamp, provenance: "system",
  };
  const identityRef = db.collection("authmodIdentities").doc(id);
  const duplicateRef = db.collection("authmodIdentities").doc(`${id}:duplicate`);
  const grantId = idempotentId("authority", "interactive", id, "integration-hub", "authmod", "Administer", "organisation");
  const grantRef = db.collection("authmodAuthorityGrants").doc(grantId);
  const appRef = db.collection("authmodApplications").doc(appId);
  const headRef = db.collection("integrationHubCacheManifests").doc("applications");
  const headBefore = (await headRef.get()).data();
  let receiptId: string | undefined;
  t.after(async () => {
    const cleanup = db.batch();
    cleanup.delete(appRef);
    cleanup.delete(identityRef);
    cleanup.delete(duplicateRef);
    cleanup.delete(grantRef);
    if (receiptId) cleanup.delete(db.collection("authmodAccessAudit").doc(receiptId));
    if (headBefore) cleanup.set(headRef, headBefore); else cleanup.delete(headRef);
    await cleanup.commit();
  });
  assert.equal((await appRef.get()).exists, false);
  await identityRef.create(identity);
  const activeGrant = {
    id: grantId, subjectId: id, subjectType: "interactive", appId: "integration-hub", resource: "authmod",
    action: "Administer", status: "active", provenance: "explicit-special-authority", scope: { kind: "organisation", ids: [] },
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  await assert.rejects(provisionBeverageStagingRegistry(operator, true), /AUTHMOD Administer/);
  await grantRef.create({ ...activeGrant, accessType: "delegated" });
  await assert.rejects(provisionBeverageStagingRegistry(operator, true), /AUTHMOD Administer/);
  assert.equal((await appRef.get()).exists, false);
  await grantRef.set(activeGrant);
  await duplicateRef.create({ ...identity, id: duplicateRef.id });
  await assert.rejects(provisionBeverageStagingRegistry(operator, true), /AUTHMOD Administer/);
  await duplicateRef.delete();
  await rebuildAuthmodReferenceReadPackage();
  const priorApplications = (await getAuthmodReferenceReadPackage()).applications;
  const repository = new FirestoreAuthModRepository();
  const unrelated = () => evaluateAuthority(repository, {
    principal: { type: "interactive", id, displayName: identity.displayName }, appId: "logistics", resource: "logistics.driver",
    action: "Manage", scope: { kind: "oploc", ids: ["oploc:fixture"] },
  });
  const unrelatedBefore = await unrelated();
  assert.equal(unrelatedBefore.allowed, false);
  const plan = await provisionBeverageStagingRegistry(operator, false);
  assert.equal(plan.status, "planned");
  receiptId = plan.auditId;
  const auditRef = db.collection("authmodAccessAudit").doc(receiptId);
  assert.equal((await appRef.get()).exists, false);
  assert.equal((await auditRef.get()).exists, false);
  assert.deepEqual((await headRef.get()).data(), headBefore);

  const outcomes = await Promise.all([provisionBeverageStagingRegistry(operator, true), provisionBeverageStagingRegistry(operator, true)]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), ["already-registered", "created"]);
  const registered = outcomes.find(result => result.status === "created");
  assert.ok(registered && registered.status === "created");
  assert.deepEqual((await appRef.get()).data(), registered.application);
  const audit = (await auditRef.get()).data();
  assert.equal(audit?.actorPrincipalId, identity.id);
  assert.equal(audit?.actorSnapshot.email, operator.email);
  assert.equal(audit?.action, "application-registered");
  assert.match(audit?.reason, /#115 staging scope.*hidden View-only/);
  assert.deepEqual(audit?.afterState, registered.application);
  assert.equal((await db.collection("authmodAccessAudit").where("targetId", "==", appId).get()).size, 1);
  await assert.rejects(getAuthmodReferenceReadPackage, { code: "AUTHMOD_REFERENCE_PACKAGE_STALE" });
  await publishBeverageRegistryReferences(registered.application);
  const packageVersion = (await getAuthmodReferenceManifest())?.packageVersion;
  await publishBeverageRegistryReferences(registered.application);
  assert.equal((await getAuthmodReferenceManifest())?.packageVersion, packageVersion);
  const applications = (await getAuthmodReferenceReadPackage()).applications;
  assert.deepEqual(applications.filter(value => value.appId !== appId), priorApplications);
  assert.deepEqual(registered.application.standardActions, ["View"]);
  assert.equal(registered.application.launchVisible, false);

  assert.deepEqual(await unrelated(), unrelatedBefore);
  assert.deepEqual(await repository.listAppAssignments(id), []);
  assert.deepEqual(await repository.listSiteAssignments(id), []);
  assert.deepEqual(await repository.listAuthorityGrants(id, "interactive"), [activeGrant]);
  const beverage = await decideBeverageSiteAuthority(read => read({
    findIdentitiesByExternal: () => Promise.resolve([identity]),
    getApplication: () => Promise.resolve(registered.application),
    readCurrentAccessPackage: () => Promise.resolve({ identity, appAssignments: [], authorityGrants: [] }),
    getActiveOploc: () => Promise.resolve(undefined),
    readCurrentOplocRedirects: () => Promise.resolve({}),
  }), async () => ({ uid: operator.uid }), { sessionCookie: "fixture", action: "View", oplocIds: ["oploc:fixture"] });
  assert.equal(beverage.reasonCode, "app-not-assigned");
  await appRef.update({ launchVisible: true });
  await assert.rejects(provisionBeverageStagingRegistry(operator, true), /differs from this command/);
  assert.equal((await appRef.get()).get("launchVisible"), true);
  assert.deepEqual((await auditRef.get()).data(), audit);
});
