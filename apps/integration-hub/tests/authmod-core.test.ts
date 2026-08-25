import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantAuthmodAdmin, grantAuthority, revokeAuthority, hasAuthmodAdmin,
  grantServiceAuthority, grantStandardApplicationAccess, revokeStandardApplicationAccess, createServicePrincipal,
  registerServiceCredential, revokeServicePrincipal, evaluateAuthority, resolveUserAccess, setFullAccess, transitionalCredentialMatches,
  previewAccessImport, commitAccessImport, reconcileLegendCandidate, assignSite, revokeSite, distinctActors, linkLegend,
  assignPrimaryCustodian, getPrimaryCustodian, createDelegation, setIdentityStatus,
} from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";

const admin: AuthPrincipal = { type: "interactive", id: "actor:admin", displayName: "AUTHMOD Operator", email: "operator@example.test" };
const makeRepo = () => new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:mnk", label: "MNK", active: true }, { id: "oploc:munich", label: "Munich RE", active: true }] });
async function identity(repository: MemoryAuthModRepository, email = "sarah@example.test") {
  return createAuthIdentity(repository, { actor: admin, displayName: "Sarah Jones", email, externalProvider: "firebase", externalUid: "uid:" + email, provenance: "migration" });
}
async function operationalIdentity(repository: MemoryAuthModRepository, email = "mnk@example.test", values: { representedOplocId?: string; operationalPurpose?: string } = {}) {
  return createAuthIdentity(repository, { actor: admin, displayName: "FIKA @ MNK", email, externalProvider: "firebase", externalUid: "uid:" + email, identityKind: "operational", ...values, provenance: "migration" });
}

test("standard application bundle is explicit, idempotent, and revocation preserves special grants", async () => {
  const repository = makeRepo(); const person = await identity(repository);
  const first = await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin });
  const second = await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin });
  assert.equal(first.assignment.id, second.assignment.id); assert.equal((await repository.listAuthorityGrants(person.id, "interactive")).length, 2);
  const special = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Reviewed maintenance authority." });
  await revokeStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin, reason: "Access removed." });
  assert.equal((await repository.getAppAssignment(first.assignment.id))?.status, "revoked");
  assert.equal((await repository.listAuthorityGrants(person.id, "interactive")).find(value => value.id === special.id)?.status, "active");
  assert.equal((await repository.listAuthorityGrants(person.id, "interactive")).filter(value => value.provenance === "standard-app-access" && value.status === "active").length, 0);
});

test("temporary app bundles share one period and expire without cleanup", async () => {
  const repository = makeRepo(); const person = await identity(repository);
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin, accessType: "temporary", effectivePeriod: { effectiveFrom: "2020-01-01T00:00:00.000Z", effectiveTo: "2020-01-02T00:00:00.000Z" }, reason: "Holiday cover." });
  const assignment = (await repository.listAppAssignments(person.id))[0]; const grant = (await repository.listAuthorityGrants(person.id, "interactive")).find(value => value.appId === "hospitality-booking");
  assert.equal(assignment.effectiveTo, grant?.effectiveTo); assert.equal((await resolveUserAccess(repository, { principal: { type: "interactive", id: person.id, displayName: person.displayName }, appId: "hospitality-booking" })).allowed, false);
});

test("temporary sites require a fixed end through the service boundary", async () => {
  const repository = makeRepo(); const person = await identity(repository);
  await assert.rejects(() => assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, accessType: "cover", effectivePeriod: { effectiveFrom: "2026-09-01T00:00:00.000Z" }, reason: "Cover." }), /fixed effective period/);
});

test("delegation is bounded, linked to a live source, and becomes ineffective with the source", async () => {
  const repository = makeRepo(); const source = await identity(repository, "source@example.test"); const delegate = await identity(repository, "delegate@example.test");
  await grantStandardApplicationAccess(repository, { identityId: delegate.id, appId: "cpu-production", actor: admin, reason: "Normal access." }); await assignSite(repository, { identityId: delegate.id, oplocId: "oploc:mnk", actor: admin, reason: "Normal site." });
  const sourceGrant = await grantAuthority(repository, { subjectId: source.id, subjectType: "interactive", actor: admin, appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Source authority." });
  const result = await createDelegation(repository, { delegatorId: source.id, delegateId: delegate.id, sourceGrantId: sourceGrant.id, action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] }, effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: "2026-09-10T00:00:00.000Z", actor: admin, reason: "Holiday cover." });
  assert.equal(result.grant.delegationSourceGrantId, sourceGrant.id); assert.equal((await evaluateAuthority(repository, { principal: { type: "interactive", id: delegate.id, displayName: delegate.displayName }, appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  await revokeAuthority(repository, { grantId: sourceGrant.id, actor: admin, reason: "Source revoked." }); assert.equal((await evaluateAuthority(repository, { principal: { type: "interactive", id: delegate.id, displayName: delegate.displayName }, appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  await assert.rejects(() => createDelegation(repository, { delegatorId: source.id, delegateId: delegate.id, sourceGrantId: result.grant.id, action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] }, effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: "2026-09-10T00:00:00.000Z", actor: admin, reason: "Recursive." }), /not currently effective/);
});

test("last administrator cannot be deactivated, but another administrator permits it", async () => {
  const repository = makeRepo(); const first = await identity(repository, "first-safety@example.test"); const second = await identity(repository, "second-safety@example.test"); await grantAuthmodAdmin(repository, { identityId: first.id, actor: admin, reason: "Admin one." });
  await assert.rejects(() => setIdentityStatus(repository, { identityId: first.id, status: "inactive", actor: admin, reason: "Deactivate." }), /last active person/);
  await grantAuthmodAdmin(repository, { identityId: second.id, actor: admin, reason: "Admin two." }); await setIdentityStatus(repository, { identityId: first.id, status: "inactive", actor: admin, reason: "Deactivate after handover." }); assert.equal((await repository.getIdentity(first.id))?.status, "inactive");
});

test("site and application intersection is enforced by the evaluator", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName, email: person.normalizedEmail };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Approved Hospitality site access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).allowed, true);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:munich" })).reasonCode, "oploc-not-assigned");
});

test("standard application access remains independent from changing site assignments", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "MNK access." });
  const bundle = await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin });
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:munich", actor: admin, reason: "Later Munich RE access." });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:munich" })).allowed, true);
  await revokeSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "MNK removed." });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).allowed, false);
  assert.equal((await repository.getAppAssignment(bundle.assignment.id))?.status, "active");
});

test("scope evaluation never widens an OPLOC grant and validates every requested OPLOC", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "MNK access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin });
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Scoped test authority." });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "organisation", ids: [] } })).allowed, false);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "oploc", ids: ["oploc:munich"] } })).allowed, false);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "oploc", ids: ["oploc:mnk", "oploc:munich"] } })).allowed, false);
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "logistics", resource: "logistics.organisation-report", action: "View", scope: { kind: "organisation", ids: [] }, reason: "Explicit organisation authority." });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.organisation-report", action: "View", scope: { kind: "organisation", ids: [] } })).allowed, true);
});

test("Full Access covers normal enabled apps and sites but never special authority", async () => {
  const repository = makeRepo(); const person = await identity(repository); await setFullAccess(repository, { identityId: person.id, fullAccess: true, actor: admin, reason: "Approved normal access." });
  const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:munich" })).allowed, true);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "logistics", resource: "logistics.repair", action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "events-dashboard" })).reasonCode, "app-disabled");
});

test("AUTHMOD Admin uses effective dates and status", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  const grant = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "integration-hub", resource: "authmod", action: "Administer", scope: { kind: "organisation", ids: [] }, effectivePeriod: { effectiveTo: "2020-01-01T00:00:00.000Z" }, reason: "Expired admin." });
  assert.equal(await hasAuthmodAdmin(repository, person.id), false);
  await repository.saveAuthorityGrant({ ...grant, effectiveFrom: "2999-01-01T00:00:00.000Z", effectiveTo: undefined, version: grant.version + 1 }, grant.version);
  assert.equal(await hasAuthmodAdmin(repository, person.id), false);
  await repository.saveAuthorityGrant({ ...grant, status: "revoked", effectiveFrom: undefined, effectiveTo: undefined, version: grant.version + 2 }, grant.version + 1);
  assert.equal(await hasAuthmodAdmin(repository, person.id), false); void principal;
});

test("AUTHMOD Admin is independent from Full Access", async () => {
  const repository = makeRepo(); const person = await identity(repository); await grantAuthmodAdmin(repository, { identityId: person.id, actor: admin, reason: "Security administration assignment." });
  const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  assert.equal((await repository.listAuthorityGrants(person.id, "interactive")).some(value => value.resource === "authmod" && value.action === "Administer"), true);
  assert.equal(person.fullAccess, false); assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production" })).allowed, false);
  assert.equal(await hasAuthmodAdmin(repository, person.id), true);
});

test("special authority is explicit and action separation is preserved", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Approved Menu Planning site access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "menu-planning", actor: admin });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Approved publisher." });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
});

test("service principals are separate and revocation denies access", async () => {
  const repository = makeRepo(); const service = await createServicePrincipal(repository, { actor: admin, name: "Delivered-In projection", ownerDomain: "Delivered-In", allowedAudiences: ["cpu-production"] });
  const servicePrincipal: AuthPrincipal = { type: "service", id: service.id, displayName: service.name }; const credential = await registerServiceCredential(repository, { principalId: service.id, actor: admin, scheme: "shared-token-transitional" });
  assert.equal(transitionalCredentialMatches({ presentedToken: "secret", expectedToken: "secret", principal: credential.principal, keyId: credential.credentialKey.keyId, audience: "cpu-production" }), true);
  assert.equal(transitionalCredentialMatches({ presentedToken: "secret", expectedToken: "secret", principal: credential.principal, keyId: credential.credentialKey.keyId, audience: "logistics" }), false);
  assert.equal(transitionalCredentialMatches({ presentedToken: "secret", expectedToken: "secret", principal: { ...credential.principal, credentialKeys: [{ ...credential.credentialKey, expiresAt: "2020-01-01T00:00:00.000Z" }] }, keyId: credential.credentialKey.keyId, audience: "cpu-production" }), false);
  await grantServiceAuthority(repository, { principalId: service.id, actor: admin, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Required cross-app projection." });
  assert.equal((await evaluateAuthority(repository, { principal: servicePrincipal, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  await revokeServicePrincipal(repository, { principalId: service.id, actor: admin, reason: "Credential retired." });
  assert.equal((await evaluateAuthority(repository, { principal: servicePrincipal, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).reasonCode, "service-inactive");
});

test("Legend candidates default to no access and spreadsheet unresolved rows cannot grant access", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "operator@example.test"); const operatorPrincipal: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName, email: operator.normalizedEmail };
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Test import administrator." });
  const candidate = await reconcileLegendCandidate(repository, { actor: admin, legendId: "legend:new", displayName: "New Starter", email: "new@example.test", active: true });
  assert.ok(candidate);
  assert.equal(candidate.fullAccess, false); assert.equal((await repository.listAppAssignments(candidate.id)).length, 0);
  const sheet = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sheet, XLSX.utils.json_to_sheet([{ Email: "unknown@example.test", Active: "yes", "app:logistics": "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(sheet, { type: "buffer", bookType: "xlsx" })), filename: "access.xlsx", actor: operatorPrincipal });
  assert.equal(preview.summary.unmatched, 1); assert.equal((await repository.listAppAssignments("unknown@example.test")).length, 0);
  await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "import-1" });
  assert.equal((await repository.listApplications()).length, 7);
});

test("Legend reconciliation links once and conflicts require review", async () => {
  const repository = makeRepo(); const first = await identity(repository, "legend@example.test");
  const linked = await reconcileLegendCandidate(repository, { actor: admin, legendId: "legend:1", displayName: "Legend Person", email: "legend@example.test", active: true });
  assert.equal(linked?.id, first.id); assert.equal((await repository.getIdentity(first.id))?.legendId, "legend:1");
  const same = await reconcileLegendCandidate(repository, { actor: admin, legendId: "legend:1", displayName: "Legend Person", email: "legend@example.test", active: true }); assert.equal(same?.id, first.id);
  const conflict = await reconcileLegendCandidate(repository, { actor: admin, legendId: "legend:2", displayName: "Changed Legend", email: "legend@example.test", active: true }); assert.equal(conflict?.identityLinkStatus, "needs-review"); assert.equal((await repository.getIdentity(first.id))?.legendId, "legend:1");
  const second = await identity(repository, "second@example.test"); await assert.rejects(() => linkLegend(repository, { identityId: second.id, legendId: "legend:1", actor: admin, reason: "Duplicate test." }), /already linked/);
});

test("import preview uses canonical booleans and reviewed identity resolution can commit", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "import-admin@example.test"); const possible = await identity(repository, "sam@example.test"); const operatorPrincipal: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName };
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Import administrator." });
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Email: "sam@workspace.test", Active: "yes", "app:logistics": "yes", "site:oploc:oploc:munich": "false", "app:unknown": "false" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), filename: "review.xlsx", actor: operatorPrincipal });
  assert.equal(preview.summary.possibleMatches, 1); assert.equal(preview.resolutions[0].proposedChanges.some(change => change.kind === "app" && change.target === "logistics"), true); assert.equal(preview.resolutions[0].proposedChanges.some(change => change.target === "unknown"), false); assert.equal(preview.resolutions[0].unresolvedReasons.some(reason => reason.includes("Unknown application")), false);
  const result = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: { [preview.resolutions[0].id]: { identityId: possible.id, accept: true } }, idempotencyKey: "reviewed-row" });
  assert.equal(result.committedRows, 1); assert.equal((await repository.listAppAssignments(possible.id)).some(value => value.appId === "logistics"), true); assert.equal((await repository.listImportResolutions(preview.record.id))[0].decidedBy, operator.id);
});

test("audit actor is server-derived for core mutations", async () => {
  const repository = makeRepo(); const person = await identity(repository); await setFullAccess(repository, { identityId: person.id, fullAccess: true, actor: admin, reason: "Test." });
  assert.equal(repository.audits.length > 0, true); assert.equal(repository.audits.at(-1)?.actorPrincipalId, "actor:admin");
});

test("expired site assignment and unavailable AUTHMOD store fail closed", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, effectivePeriod: { effectiveTo: "2020-01-01T00:00:00.000Z" }, reason: "Expired test assignment." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).reasonCode, "oploc-not-assigned");
  const unavailable = makeRepo(); unavailable.getIdentity = async () => { throw new Error("store unavailable"); };
  assert.equal((await resolveUserAccess(unavailable, { principal, appId: "hospitality-booking" })).reasonCode, "store-unavailable");
});

test("import commit is idempotent and signature policy rejects one actor twice", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "operator-2@example.test"); const operatorPrincipal: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName };
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Test import administrator." });
  const sheet = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sheet, XLSX.utils.json_to_sheet([{ Email: "nobody@example.test", Active: "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(sheet, { type: "buffer", bookType: "xlsx" })), filename: "access.xlsx", actor: operatorPrincipal });
  const first = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: { [preview.resolutions[0].id]: { accept: false } }, idempotencyKey: "same-import" });
  const second = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "same-import" });
  assert.equal(second.committedRows, first.committedRows); assert.equal(second.importId, first.importId); assert.equal(distinctActors(["uid:one", "uid:one"]), false); assert.equal(distinctActors(["uid:one", "uid:two"]), true);
  await assert.rejects(() => commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "different-import" }), /already been committed/);
});

test("operational authority fails closed when OPLOC scope is omitted", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Hospitality site." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "hospitality-booking", resource: "hospitality-booking.normal", action: "Manage" })).reasonCode, "invalid-request");
  assert.equal((await evaluateAuthority(repository, { principal, appId: "hospitality-booking", resource: "hospitality-booking.normal", action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Scoped publisher." });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish" })).reasonCode, "invalid-request");
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking" })).allowed, true);
});

test("canonical OPLOC lifecycle is required for assignments and Full Access", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Active site." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "hospitality-booking", resource: "hospitality-booking.normal", action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  repository.oplocs.set("oploc:mnk", { id: "oploc:mnk", label: "MNK", active: false });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "hospitality-booking", resource: "hospitality-booking.normal", action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).reasonCode, "oploc-not-assigned");
  const full = await identity(repository, "full@example.test"); await setFullAccess(repository, { identityId: full.id, fullAccess: true, actor: admin, reason: "Normal access." });
  const fullPrincipal: AuthPrincipal = { type: "interactive", id: full.id, displayName: full.displayName };
  assert.equal((await resolveUserAccess(repository, { principal: fullPrincipal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).reasonCode, "oploc-not-assigned");
  assert.equal((await resolveUserAccess(repository, { principal: fullPrincipal, appId: "hospitality-booking", oplocId: "oploc:unknown" })).reasonCode, "oploc-not-assigned");
});

test("Legend display text is never persisted as a canonical Legend ID", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "legend-import-admin@example.test"); const existing = await identity(repository, "legend-import@example.test");
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Import admin." });
  const operatorPrincipal: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Email: existing.normalizedEmail, Legend: "Sarah Jones", Active: "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), filename: "legend-display.xlsx", actor: operatorPrincipal });
  await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: { [preview.resolutions[0].id]: { identityId: existing.id, accept: true } }, idempotencyKey: "legend-display-1" });
  assert.equal((await repository.getIdentity(existing.id))?.legendId, undefined);
});

test("imports remain partial until every row is explicitly finalized and resume skips applied rows", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "partial-import-admin@example.test"); const existing = await identity(repository, "partial-existing@example.test");
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Import admin." }); const operatorPrincipal: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Email: existing.normalizedEmail, Active: "yes", "app:logistics": "yes" }, { Email: "unresolved-partial@example.test", Active: "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), filename: "partial.xlsx", actor: operatorPrincipal });
  const first = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: { [preview.resolutions[0].id]: { identityId: existing.id, accept: true } }, idempotencyKey: "partial-1" });
  assert.equal(first.status, "partial"); assert.equal((await repository.listAppAssignments(existing.id)).length, 1); assert.equal((await repository.listImportResolutions(preview.record.id))[0].appliedAt !== undefined, true);
  const second = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: { [preview.resolutions[1].id]: { accept: false } }, idempotencyKey: "partial-2" });
  assert.equal(second.status, "committed"); assert.equal((await repository.listAppAssignments(existing.id)).length, 1);
  const auditsAfterFinal = repository.audits.length; const retry = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "partial-2" });
  assert.equal(retry.importId, preview.record.id); assert.equal(repository.audits.length, auditsAfterFinal);
});

test("interactive identity taxonomy separates person and operational accounts", async () => {
  const repository = makeRepo(); const person = await identity(repository, "tia@example.test"); const operational = await operationalIdentity(repository, "mnk-account@example.test", { representedOplocId: "oploc:mnk" }); const functionAccount = await operationalIdentity(repository, "accounts@example.test", { operationalPurpose: "Accounts" });
  assert.equal(person.identityKind, "person"); assert.equal(person.legendId, undefined); assert.equal(operational.identityKind, "operational"); assert.equal(operational.representedOplocId, "oploc:mnk"); assert.equal(operational.legendId, undefined); assert.equal(functionAccount.operationalPurpose, "Accounts");
  assert.equal((await repository.listCustodianAssignments(operational.id)).length, 0);
});

test("custodianship is separate, supports multiple accounts and handover without authority inheritance", async () => {
  const repository = makeRepo(); const person = await identity(repository, "tia-custodian@example.test"); const first = await operationalIdentity(repository, "mnk-custody@example.test", { representedOplocId: "oploc:mnk" }); const second = await operationalIdentity(repository, "munich-custody@example.test", { representedOplocId: "oploc:munich" });
  const firstCustody = await assignPrimaryCustodian(repository, { operationalIdentityId: first.id, custodianLegendId: "legend:tia", actor: admin, reason: "MNK operational owner." });
  await assignPrimaryCustodian(repository, { operationalIdentityId: second.id, custodianLegendId: "legend:tia", actor: admin, reason: "Munich operational owner." });
  const handover = await assignPrimaryCustodian(repository, { operationalIdentityId: first.id, custodianLegendId: "legend:other", actor: admin, reason: "Custodian handover." });
  assert.equal(handover.operationalIdentityId, first.id); assert.equal((await repository.getIdentity(first.id))?.id, first.id); assert.equal((await getPrimaryCustodian(repository, first.id))?.custodianLegendId, "legend:other");
  assert.equal((await getPrimaryCustodian(repository, second.id))?.custodianLegendId, "legend:tia"); assert.equal((await repository.listCustodianAssignments(first.id)).find(value => value.id === firstCustody.id)?.status, "revoked");
  const personPrincipal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  assert.equal((await resolveUserAccess(repository, { principal: personPrincipal, appId: "logistics" })).allowed, false);
  assert.equal((await resolveUserAccess(repository, { principal: { type: "interactive", id: first.id, displayName: first.displayName }, appId: "logistics" })).allowed, false);
});

test("operational identities receive normal scoped access but not person-required authority or Full Access", async () => {
  const repository = makeRepo(); const operational = await operationalIdentity(repository); const principal: AuthPrincipal = { type: "interactive", id: operational.id, displayName: operational.displayName, identityKind: "operational", representedOplocId: "oploc:mnk" };
  await assignSite(repository, { identityId: operational.id, oplocId: "oploc:mnk", actor: admin, reason: "Operational MNK account site." });
  await grantStandardApplicationAccess(repository, { identityId: operational.id, appId: "hospitality-booking", actor: admin });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "hospitality-booking", resource: "hospitality-booking.normal", action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  await assert.rejects(() => setFullAccess(repository, { identityId: operational.id, fullAccess: true, actor: admin, reason: "Invalid operational Full Access." }), /person identities/);
  await repository.saveIdentity({ ...operational, fullAccess: true, version: operational.version + 1 }, operational.version);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "logistics" })).reasonCode, "app-not-assigned");
  const personRequired = [["integration-hub", "authmod", "Administer"], ["menu-planning", "menu.publish", "Publish"], ["cpu-production", "production.allergen-sign", "Approve"], ["cpu-production", "production.allergen-final-approve", "Approve"]] as const;
  for (const [appId, resource, action] of personRequired) {
    await assert.rejects(() => grantAuthority(repository, { subjectId: operational.id, subjectType: "interactive", actor: admin, appId, resource, action, scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Invalid operational authority." }), /person identity/);
  }
});

test("person-required policy denies erroneous operational grants and allows person grants", async () => {
  const repository = makeRepo(); const person = await identity(repository, "person-authority@example.test"); const operational = await operationalIdentity(repository, "operational-authority@example.test");
  const personPrincipal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName, identityKind: "person" }; const operationalPrincipal: AuthPrincipal = { type: "interactive", id: operational.id, displayName: operational.displayName, identityKind: "operational" };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Person site." }); await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "menu-planning", actor: admin });
  await assignSite(repository, { identityId: operational.id, oplocId: "oploc:mnk", actor: admin, reason: "Operational site." }); await grantStandardApplicationAccess(repository, { identityId: operational.id, appId: "menu-planning", actor: admin });
  const personGrant = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Person publisher." });
  assert.equal((await evaluateAuthority(repository, { principal: personPrincipal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "cpu-production", actor: admin });
  const signGrant = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "cpu-production", resource: "production.allergen-sign", action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Person allergen signer." });
  const finalGrant = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor: admin, appId: "cpu-production", resource: "production.allergen-final-approve", action: "Approve", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Person final approver." });
  assert.equal((await evaluateAuthority(repository, { principal: personPrincipal, appId: "cpu-production", resource: signGrant.resource, action: signGrant.action, scope: signGrant.scope })).allowed, true);
  assert.equal((await evaluateAuthority(repository, { principal: personPrincipal, appId: "cpu-production", resource: finalGrant.resource, action: finalGrant.action, scope: finalGrant.scope })).allowed, true);
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "integration-hub", actor: admin }); const adminGrant = await grantAuthmodAdmin(repository, { identityId: person.id, actor: admin, reason: "Person admin." });
  assert.equal((await evaluateAuthority(repository, { principal: personPrincipal, appId: "integration-hub", resource: adminGrant.resource, action: adminGrant.action, scope: adminGrant.scope })).allowed, true);
  await repository.saveAuthorityGrant({ ...personGrant, id: "bad-operational-menu-grant", subjectId: operational.id, version: 1 }, undefined);
  assert.equal((await evaluateAuthority(repository, { principal: operationalPrincipal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  await repository.saveAuthorityGrant({ ...adminGrant, id: "bad-operational-admin-grant", subjectId: operational.id, version: 1 }, undefined);
  assert.equal(await hasAuthmodAdmin(repository, operational.id), false);
});

test("operational actor audit remains operational and does not claim the custodian acted", async () => {
  const repository = makeRepo(); const operational = await operationalIdentity(repository, "audit-mnk@example.test", { representedOplocId: "oploc:mnk" });
  const actor: AuthPrincipal = { type: "interactive", id: operational.id, displayName: operational.displayName, identityKind: "operational", representedOplocId: "oploc:mnk", primaryCustodianLegendId: "legend:tia" };
  await grantStandardApplicationAccess(repository, { identityId: operational.id, appId: "logistics", actor });
  const audit = repository.audits.at(-1); assert.equal(audit?.actorPrincipalId, operational.id); assert.equal(audit?.actorPrincipalType, "interactive"); assert.equal(audit?.actorSnapshot.identityKind, "operational"); assert.equal(audit?.actorSnapshot.primaryCustodianLegendId, "legend:tia");
});

test("workspace operational classification remains unresolved until reviewed", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "workspace-classifier@example.test"); await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Import admin." }); const actor: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Email: "mnk@example.test", DisplayName: "FIKA @ MNK", "Account Type": "operational", "app:hospitality-booking": "true" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), filename: "workspace-accounts.xlsx", actor });
  assert.equal(preview.resolutions[0].suggestedIdentityKind, "operational"); assert.equal(preview.resolutions[0].selectedIdentityId, undefined); assert.equal(preview.resolutions[0].unresolvedReasons.some(value => value.includes("classification")), true);
  const result = await commitAccessImport(repository, { importId: preview.record.id, actor, decisions: {}, idempotencyKey: "workspace-kind-1" }); assert.equal(result.status, "partial");
});

test("normal AUTHMOD administration cannot remove the last active person administrator", async () => {
  const repository = makeRepo(); const first = await identity(repository, "first-admin@example.test"); const second = await identity(repository, "second-admin@example.test");
  const firstGrant = await grantAuthmodAdmin(repository, { identityId: first.id, actor: admin, reason: "First administrator." }); await grantAuthmodAdmin(repository, { identityId: second.id, actor: admin, reason: "Second administrator." });
  const actor: AuthPrincipal = { type: "interactive", id: second.id, displayName: second.displayName, identityKind: "person" };
  await revokeAuthority(repository, { grantId: firstGrant.id, actor, reason: "Administrator rotation." });
  assert.equal(await hasAuthmodAdmin(repository, first.id), false);
  const secondGrant = (await repository.listAuthorityGrants(second.id, "interactive")).find(value => value.resource === "authmod");
  await assert.rejects(() => revokeAuthority(repository, { grantId: secondGrant!.id, actor, reason: "Accidental lockout." }), /last active person/);
});
