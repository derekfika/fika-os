import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantAuthmodAdmin, grantAuthority,
  grantServiceAuthority, grantStandardApplicationAccess, revokeStandardApplicationAccess, createServicePrincipal,
  registerServiceCredential, revokeServicePrincipal, evaluateAuthority, resolveUserAccess, setFullAccess,
  previewAccessImport, commitAccessImport, reconcileLegendCandidate, assignSite, distinctActors,
} from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";

const admin: AuthPrincipal = { type: "human", id: "actor:admin", displayName: "AUTHMOD Operator", email: "operator@example.test" };
const makeRepo = () => new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:mnk", label: "MNK", active: true }, { id: "oploc:munich", label: "Munich RE", active: true }] });
async function identity(repository: MemoryAuthModRepository, email = "sarah@example.test") {
  return createAuthIdentity(repository, { actor: admin, displayName: "Sarah Jones", email, externalProvider: "firebase", externalUid: "uid:" + email, provenance: "migration" });
}

test("standard application bundle is explicit, idempotent, and revocation preserves special grants", async () => {
  const repository = makeRepo(); const person = await identity(repository);
  const first = await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin, scopeIds: ["oploc:mnk"] });
  const second = await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin, scopeIds: ["oploc:mnk"] });
  assert.equal(first.assignment.id, second.assignment.id); assert.equal((await repository.listAuthorityGrants(person.id, "human")).length, 2);
  const special = await grantAuthority(repository, { subjectId: person.id, subjectType: "human", actor: admin, appId: "logistics", resource: "logistics.repair", action: "Administer", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Reviewed maintenance authority." });
  await revokeStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin, reason: "Access removed." });
  assert.equal((await repository.getAppAssignment(first.assignment.id))?.status, "revoked");
  assert.equal((await repository.listAuthorityGrants(person.id, "human")).find(value => value.id === special.id)?.status, "active");
  assert.equal((await repository.listAuthorityGrants(person.id, "human")).filter(value => value.provenance === "standard-app-access" && value.status === "active").length, 0);
});

test("site and application intersection is enforced by the evaluator", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "human", id: person.id, displayName: person.displayName, email: person.normalizedEmail };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Approved Hospitality site access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin, scopeIds: ["oploc:mnk"] });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).allowed, true);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:munich" })).reasonCode, "oploc-not-assigned");
});

test("Full Access covers normal enabled apps and sites but never special authority", async () => {
  const repository = makeRepo(); const person = await identity(repository); await setFullAccess(repository, { identityId: person.id, fullAccess: true, actor: admin, reason: "Approved normal access." });
  const principal: AuthPrincipal = { type: "human", id: person.id, displayName: person.displayName };
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:munich" })).allowed, true);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "events-dashboard" })).reasonCode, "app-disabled");
});

test("AUTHMOD Admin is independent from Full Access", async () => {
  const repository = makeRepo(); const person = await identity(repository); await grantAuthmodAdmin(repository, { identityId: person.id, actor: admin, reason: "Security administration assignment." });
  const principal: AuthPrincipal = { type: "human", id: person.id, displayName: person.displayName };
  assert.equal((await repository.listAuthorityGrants(person.id, "human")).some(value => value.resource === "authmod" && value.action === "Administer"), true);
  assert.equal(person.fullAccess, false); assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production" })).allowed, false);
});

test("special authority is explicit and action separation is preserved", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "human", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, reason: "Approved Menu Planning site access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "menu-planning", actor: admin, scopeIds: ["oploc:mnk"] });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, false);
  await grantAuthority(repository, { subjectId: person.id, subjectType: "human", actor: admin, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Approved publisher." });
  assert.equal((await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
});

test("service principals are separate and revocation denies access", async () => {
  const repository = makeRepo(); const service = await createServicePrincipal(repository, { actor: admin, name: "Delivered-In projection", ownerDomain: "Delivered-In", allowedAudiences: ["cpu-production"] });
  const servicePrincipal: AuthPrincipal = { type: "service", id: service.id, displayName: service.name }; await registerServiceCredential(repository, { principalId: service.id, actor: admin, scheme: "shared-token-transitional" });
  await grantServiceAuthority(repository, { principalId: service.id, actor: admin, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] }, reason: "Required cross-app projection." });
  assert.equal((await evaluateAuthority(repository, { principal: servicePrincipal, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).allowed, true);
  await revokeServicePrincipal(repository, { principalId: service.id, actor: admin, reason: "Credential retired." });
  assert.equal((await evaluateAuthority(repository, { principal: servicePrincipal, appId: "cpu-production", resource: "cpu.delivered-in-projection", action: "View", scope: { kind: "oploc", ids: ["oploc:mnk"] } })).reasonCode, "service-inactive");
});

test("Legend candidates default to no access and spreadsheet unresolved rows cannot grant access", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "operator@example.test"); const operatorPrincipal: AuthPrincipal = { type: "human", id: operator.id, displayName: operator.displayName, email: operator.normalizedEmail };
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Test import administrator." });
  const candidate = await reconcileLegendCandidate(repository, { actor: admin, legendId: "legend:new", displayName: "New Starter", email: "new@example.test", active: true });
  assert.equal(candidate.fullAccess, false); assert.equal((await repository.listAppAssignments(candidate.id)).length, 0);
  const sheet = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sheet, XLSX.utils.json_to_sheet([{ Email: "unknown@example.test", Active: "yes", "app:logistics": "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(sheet, { type: "buffer", bookType: "xlsx" })), filename: "access.xlsx", actor: operatorPrincipal });
  assert.equal(preview.summary.unmatched, 1); assert.equal((await repository.listAppAssignments("unknown@example.test")).length, 0);
  await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "import-1" });
  assert.equal((await repository.listApplications()).length, 7);
});

test("audit actor is server-derived for core mutations", async () => {
  const repository = makeRepo(); const person = await identity(repository); await setFullAccess(repository, { identityId: person.id, fullAccess: true, actor: admin, reason: "Test." });
  assert.equal(repository.audits.length > 0, true); assert.equal(repository.audits.at(-1)?.actorPrincipalId, "actor:admin");
});

test("expired site assignment and unavailable AUTHMOD store fail closed", async () => {
  const repository = makeRepo(); const person = await identity(repository); const principal: AuthPrincipal = { type: "human", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:mnk", actor: admin, effectivePeriod: { effectiveTo: "2020-01-01T00:00:00.000Z" }, reason: "Expired test assignment." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor: admin, scopeIds: ["oploc:mnk"] });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: "oploc:mnk" })).reasonCode, "oploc-not-assigned");
  const unavailable = makeRepo(); unavailable.getIdentity = async () => { throw new Error("store unavailable"); };
  assert.equal((await resolveUserAccess(unavailable, { principal, appId: "hospitality-booking" })).reasonCode, "store-unavailable");
});

test("import commit is idempotent and signature policy rejects one actor twice", async () => {
  const repository = makeRepo(); const operator = await identity(repository, "operator-2@example.test"); const operatorPrincipal: AuthPrincipal = { type: "human", id: operator.id, displayName: operator.displayName };
  await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Test import administrator." });
  const sheet = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sheet, XLSX.utils.json_to_sheet([{ Email: "nobody@example.test", Active: "yes" }]), "Access");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(sheet, { type: "buffer", bookType: "xlsx" })), filename: "access.xlsx", actor: operatorPrincipal });
  const first = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "same-import" });
  const second = await commitAccessImport(repository, { importId: preview.record.id, actor: operatorPrincipal, decisions: {}, idempotencyKey: "same-import" });
  assert.deepEqual(second, first); assert.equal(distinctActors(["uid:one", "uid:one"]), false); assert.equal(distinctActors(["uid:one", "uid:two"]), true);
});
