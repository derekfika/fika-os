import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantAllActiveOplocAccess,
  grantStandardApplicationAccess, resolveUserAccess, revokeAllActiveOplocAccess, revokeStandardApplicationAccess,
  setFullAccess, evaluateAuthority, assignSite,
} from "../lib/authmod-core";
import { filterAuthorizedOplocs, resolvePermittedOplocIds } from "../lib/oploc-authorization";
import { isActiveCanonicalOploc } from "../lib/canonical-oplocs";
import type { AuthPrincipal } from "../lib/authmod-core";

const actor: AuthPrincipal = { type: "interactive", id: "admin", displayName: "AUTHMOD Admin", identityKind: "person" };

async function operational(repository: MemoryAuthModRepository, email = "cpux@example.test") {
  return createAuthIdentity(repository, { actor, displayName: "CPUX", email, externalProvider: "firebase", externalUid: `uid:${email}`, identityKind: "operational", operationalPurpose: "CPU Production", provenance: "migration" });
}

test("All Sites Access resolves newly created active OPLOCs dynamically and is audited", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:existing", label: "Existing", active: true }] });
  const identity = await operational(repository);
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU operating account." });
  const scope = await grantAllActiveOplocAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU production coverage." });
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "operational" };
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:existing" })).allowed, true);

  repository.oplocs.set("oploc:new-site", { id: "oploc:new-site", label: "New site", active: true });
  const decision = await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:new-site" });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.matchedAccessScopeIds, [scope.id]);
  const listingScope = await resolvePermittedOplocIds({ repository, principal, appId: "cpu-production" });
  assert.equal(listingScope.all, true);
  const filtered = filterAuthorizedOplocs({ oplocs: [{ canonicalId: "oploc:existing", label: "Existing" }, { canonicalId: "oploc:new-site", label: "New site" }] }, listingScope);
  assert.deepEqual(filtered.oplocs.map(value => value.canonicalId), ["oploc:existing", "oploc:new-site"]);
  assert.equal(repository.audits.at(-1)?.action, "all-active-oploc-access-granted");
  assert.equal(repository.audits.at(-1)?.targetId, scope.id);
});

test("All Sites Access is isolated to its app and grants no additional actions", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:a", label: "A", active: true }, { id: "oploc:b", label: "B", active: true }] });
  const identity = await operational(repository);
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "operational" };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU operating account." });
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "menu-planning", actor, reason: "Menu account admission test." });
  await grantAllActiveOplocAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU production coverage." });

  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:b" })).allowed, true);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "menu-planning", oplocId: "oploc:b" })).reasonCode, "oploc-not-assigned");
  assert.equal((await evaluateAuthority(repository, { principal, appId: "cpu-production", resource: "cpu-production.normal", action: "Manage", scope: { kind: "oploc", ids: ["oploc:b"] } })).allowed, true);
  assert.equal((await evaluateAuthority(repository, { principal, appId: "cpu-production", resource: "cpu-production.normal", action: "Approve", scope: { kind: "oploc", ids: ["oploc:b"] } })).reasonCode, "authority-not-granted");
  assert.equal((await resolveUserAccess(repository, { principal, appId: "integration-hub" })).allowed, false);
  assert.equal((await resolvePermittedOplocIds({ repository, principal, appId: "cpu-production" })).all, true);
  assert.deepEqual([...((await resolvePermittedOplocIds({ repository, principal, appId: "menu-planning" })).ids)], []);
  assert.equal(isActiveCanonicalOploc({ entityType: "OPLOC", canonicalId: "oploc:active", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } }), true);
  assert.equal(isActiveCanonicalOploc({ entityType: "OPLOC", canonicalId: "oploc:archived", lifecycleStatus: "archived", publicationStatus: "published", record: { lifecycleState: "active" } }), false);
});

test("revoking All Sites Access removes only that app-wide scope and preserves selected site grants", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:a", label: "A", active: true }, { id: "oploc:b", label: "B", active: true }] });
  const identity = await operational(repository);
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "operational" };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU operating account." });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:a", actor, reason: "Existing selected-site grant." });
  await grantAllActiveOplocAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU production coverage." });
  await revokeAllActiveOplocAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "Coverage no longer required." });

  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:a" })).allowed, true);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:b" })).reasonCode, "oploc-not-assigned");
  assert.equal(repository.audits.at(-1)?.action, "all-active-oploc-access-revoked");
});

test("ordinary people, unassigned apps, and Superuser state cannot be conflated with All Sites Access", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:a", label: "A", active: true }] });
  const person = await createAuthIdentity(repository, { actor, displayName: "Person", email: "person@example.test", externalProvider: "firebase", externalUid: "uid:person", provenance: "migration" });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "cpu-production", actor, reason: "CPU access." });
  await assert.rejects(() => grantAllActiveOplocAccess(repository, { identityId: person.id, appId: "cpu-production", actor, reason: "Not an operational identity." }), /operational accounts only/);

  const account = await operational(repository, "other@example.test");
  await assert.rejects(() => grantAllActiveOplocAccess(repository, { identityId: account.id, appId: "cpu-production", actor, reason: "No app admission." }), /Grant application access/);
  await setFullAccess(repository, { identityId: person.id, fullAccess: true, actor, reason: "Separate Superuser test." });
  assert.equal((await repository.listAppOplocScopes(person.id)).length, 0);
  assert.equal((await repository.getIdentity(person.id))?.fullAccess, true);
  assert.equal((await repository.getIdentity(account.id))?.fullAccess, false);
});

test("revoking application admission also retires its All Sites Access", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:a", label: "A", active: true }, { id: "oploc:b", label: "B", active: true }] });
  const identity = await operational(repository);
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "operational" };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU operating account." });
  const scope = await grantAllActiveOplocAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU production coverage." });
  await revokeStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU app access removed." });
  assert.equal((await repository.getAppOplocScope(scope.id))?.status, "revoked");
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "CPU access restored without broad site scope." });
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: "oploc:b" })).reasonCode, "oploc-not-assigned");
  assert.equal(repository.audits.at(-1)?.action, "standard-application-access-granted");
  assert.ok(repository.audits.some(event => event.action === "all-active-oploc-access-revoked-with-app-access"));
});
