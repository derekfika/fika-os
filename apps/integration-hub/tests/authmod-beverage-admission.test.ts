import assert from "node:assert/strict";
import test from "node:test";
import {
  BEVERAGE_AUTHMOD_APP_ID, BEVERAGE_AUTHMOD_APPROVAL_RESOURCE, BEVERAGE_AUTHMOD_NORMAL_ACTIONS,
  BEVERAGE_AUTHMOD_NORMAL_BUNDLE, BEVERAGE_AUTHMOD_NORMAL_RESOURCE, MAX_BEVERAGE_OPLOC_SCOPE, decideBeverageSiteAuthority,
  type ReadOnlyBeverageAuthority,
} from "../lib/authmod-core/beverage-admission";
import { createDelegation, grantAuthority } from "../lib/authmod-core/authority";
import { evaluateAuthority, resolveUserAccess } from "../lib/authmod-core/evaluator";
import { assignSite, grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { createAuthIdentity, setFullAccess } from "../lib/authmod-core/identity";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import { V1_APPLICATIONS, type ApplicationRegistryEntry, type AuthModAction, type AuthPrincipal } from "../lib/authmod-core/model";

const actor: AuthPrincipal = { type: "interactive", id: "fixture:authmod-operator", displayName: "Fixture operator" };
const uid = "fixture:beverage-firebase-uid";
const site = "oploc:fixture-a";
const otherSite = "oploc:fixture-b";
const legacySite = "oploc:fixture-legacy-a";
const app: ApplicationRegistryEntry = {
  appId: BEVERAGE_AUTHMOD_APP_ID, displayName: "Beverage Innovation", enabled: true, launchVisible: false,
  scopeModel: "oploc", standardBundleId: BEVERAGE_AUTHMOD_NORMAL_BUNDLE, standardResource: BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
  standardActions: [...BEVERAGE_AUTHMOD_NORMAL_ACTIONS], version: 1, createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z", provenance: "migration",
};

class FixtureRepository extends MemoryAuthModRepository {
  redirects: Record<string, string> = { [legacySite]: site };
  async readCurrentOplocRedirects() { return this.redirects; }
  async readCurrentAccessPackage(identityId: string): ReturnType<ReadOnlyBeverageAuthority["readCurrentAccessPackage"]> {
    return {
      identity: (await this.getIdentity(identityId))!, appAssignments: await this.listAppAssignments(identityId),
      authorityGrants: await this.listAuthorityGrants(identityId),
    };
  }
  override async findIdentitiesByEmail(): Promise<never> { throw new Error("A decision must never look up email."); }
}

async function fixture({ registered = true, bound = true } = {}) {
  const repository = new FixtureRepository({
    applications: [...V1_APPLICATIONS, ...(registered ? [app] : [])],
    oplocs: [{ id: site, label: "Fixture A", active: true }, { id: otherSite, label: "Fixture B", active: true }],
  });
  const identity = await createAuthIdentity(repository, {
    actor, displayName: "Fixture reviewer",
    ...(bound ? { externalProvider: "firebase", externalUid: uid } : {}),
  });
  const verify = async (cookie: string, checkRevoked: true) => {
    assert.equal(checkRevoked, true);
    if (cookie !== "fixture:verified-session") throw new Error("Invalid or revoked fixture cookie.");
    return { uid };
  };
  const decide = (action: AuthModAction, oplocIds: string[] = [site], sessionCookie = "fixture:verified-session") =>
    decideBeverageSiteAuthority(read => read(repository), verify, { action, oplocIds, sessionCookie });
  const grantNormal = () => grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor });
  const grantSite = (oplocId = site) => assignSite(repository, { identityId: identity.id, oplocId, actor, reason: "Fictional assignment." });
  const grantScoped = (action: AuthModAction = "View", ids: string[] = [site]) => grantAuthority(repository, {
    subjectId: identity.id, subjectType: "interactive", actor, appId: app.appId,
    resource: action === "Approve" ? BEVERAGE_AUTHMOD_APPROVAL_RESOURCE : BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
    action, scope: { kind: "oploc", ids }, reason: "Fictional Beverage site entitlement.",
  });
  return { repository, identity, decide, grantNormal, grantSite, grantScoped };
}

test("the verified, unique existing Firebase binding is required and decisions never write", async () => {
  const unbound = await fixture({ bound: false });
  const initialAudit = unbound.repository.audits.length;
  assert.equal((await unbound.decide("View")).reasonCode, "unauthenticated");
  assert.equal((await unbound.decide("View", [site], "")).reasonCode, "unauthenticated");
  assert.equal((await unbound.decide("View", [site], "fixture:revoked")).reasonCode, "unauthenticated");
  assert.equal(unbound.repository.audits.length, initialAudit);
  assert.equal((await unbound.repository.getIdentity(unbound.identity.id))?.externalUid, undefined);

  const bound = await fixture();
  await bound.grantNormal();
  await bound.grantScoped();
  const auditBeforeRead = bound.repository.audits.length;
  assert.equal((await bound.decide("View")).allowed, true);
  assert.equal(bound.repository.audits.length, auditBeforeRead);
  bound.repository.identities.set("fixture:duplicate", { ...bound.identity, id: "fixture:duplicate" });
  assert.equal((await bound.decide("View")).reasonCode, "unauthenticated");
  bound.repository.identities.delete("fixture:duplicate");
  bound.repository.identities.set(bound.identity.id, { ...bound.identity, status: "inactive" });
  assert.equal((await bound.decide("View")).reasonCode, "identity-inactive");
});

test("generic sites, organisation grants and Full Access cannot replace an explicit Beverage entitlement", async () => {
  const unregistered = await fixture({ registered: false });
  assert.equal((await unregistered.decide("View")).reasonCode, "app-disabled");

  const { repository, identity, decide, grantNormal, grantSite, grantScoped } = await fixture();
  await grantSite();
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor, reason: "Fictional legacy Full Access." });
  assert.equal((await decide("View")).reasonCode, "app-not-assigned");
  await grantNormal();
  assert.equal((await decide("View")).reasonCode, "authority-not-granted");
  await grantScoped();
  assert.equal((await decide("View")).allowed, true);
  assert.equal((await decide("View", [site, otherSite])).reasonCode, "authority-not-granted");
  for (const registry of [{ ...app, enabled: false }, { ...app, launchVisible: true }, { ...app, standardActions: [...app.standardActions, "Approve" as const] }]) {
    repository.applications.set(app.appId, registry);
    assert.equal((await decide("View")).reasonCode, "app-disabled");
  }
});

test("only requested aliases resolve; stale entitlement IDs, absent sites and inactive sites deny", async () => {
  const { repository, decide, grantNormal, grantScoped } = await fixture();
  await grantNormal();
  await assert.rejects(grantScoped("View", [legacySite]), { code: "AUTHMOD_BEVERAGE_SCOPE_INVALID" });
  const grant = await grantScoped();
  assert.equal((await decide("View", [])).reasonCode, "invalid-request");
  assert.equal((await decide("View", Array(101).fill(site))).reasonCode, "invalid-request");
  assert.equal((await decide("View", [" "])).reasonCode, "invalid-request");
  assert.equal((await decide("View", ["Fixture A"])).reasonCode, "oploc-not-assigned");
  const aliasDecision = await decide("View", [legacySite, site]);
  assert.equal(aliasDecision.allowed, true);
  assert.deepEqual(aliasDecision.scope, { kind: "oploc", ids: [site] });
  repository.grants.set(grant.id, { ...grant, scope: { kind: "oploc", ids: [legacySite] } });
  assert.equal((await decide("View", [legacySite])).reasonCode, "authority-not-granted");
  repository.grants.set(grant.id, grant);
  repository.redirects = { [legacySite]: site, [site]: legacySite };
  assert.equal((await decide("View", [legacySite])).reasonCode, "store-unavailable");
  repository.redirects = { [legacySite]: site };
  repository.oplocs.set(site, { id: site, active: false, label: "Fixture A" });
  assert.equal((await decide("View", [legacySite])).reasonCode, "oploc-not-assigned");
  repository.oplocs.delete(site);
  assert.equal((await decide("View", [legacySite])).reasonCode, "oploc-not-assigned");
});

test("actions are exact and approval requires separate, direct, site-scoped authority", async () => {
  const { repository, decide, grantNormal, grantScoped } = await fixture();
  await grantNormal();
  await grantScoped();
  const contribute = await grantScoped("Contribute", [site, otherSite]);
  await grantScoped("Manage");
  assert.equal((await decide("Contribute", [site, otherSite])).allowed, true);
  repository.grants.set(contribute.id, { ...contribute, status: "revoked" });
  assert.equal((await decide("View")).allowed, true);
  assert.equal((await decide("Manage")).allowed, true);
  assert.equal((await decide("Contribute")).reasonCode, "authority-not-granted");
  assert.equal((await decide("Approve")).reasonCode, "authority-not-granted");
  assert.equal((await decide("Publish")).reasonCode, "invalid-request");
  assert.equal((await decide("Administer")).reasonCode, "invalid-request");
  const approval = await grantScoped("Approve");
  assert.deepEqual((await decide("Approve")).matchedGrantIds, [approval.id]);
  assert.equal((await decide("Approve", [site, otherSite])).reasonCode, "authority-not-granted");
  for (const invalid of [
    { ...approval, scope: { kind: "organisation" as const, ids: [] } },
    { ...approval, subjectType: "service" as const },
    { ...approval, provenance: "standard-app-access" as const },
    { ...approval, delegationSourceGrantId: "fixture:delegated" },
    { ...approval, effectiveTo: "2020-01-01T00:00:00.000Z" },
    { ...approval, effectiveFrom: "invalid-date" },
  ]) {
    repository.grants.set(approval.id, invalid);
    assert.equal((await decide("Approve")).reasonCode, "authority-not-granted");
  }
});

test("unavailable and inconsistent authority packages fail closed", async () => {
  const { repository, identity, decide, grantNormal, grantScoped } = await fixture();
  await grantNormal();
  await grantScoped();
  const access = await repository.readCurrentAccessPackage(identity.id);
  repository.readCurrentAccessPackage = async () => ({ ...access, identity: { ...identity, version: identity.version - 1 } });
  assert.equal((await decide("View")).reasonCode, "store-unavailable");
  repository.readCurrentAccessPackage = async () => { throw new Error("Current package missing."); };
  assert.equal((await decide("View")).reasonCode, "store-unavailable");
});

test("a View-only app and direct Beverage grant cannot add sites or authority in another app", async () => {
  const { repository, identity, decide, grantNormal, grantScoped } = await fixture();
  repository.applications.set(app.appId, { ...app, standardActions: ["View"] });
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "menu-planning", actor });
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName };
  const menu = () => resolveUserAccess(repository, { principal, appId: "menu-planning", oplocId: site });
  const before = await menu();
  assert.equal(before.allowed, false);
  const { grants } = await grantNormal();
  assert.deepEqual(grants.map(grant => grant.action), ["View"]);
  const view = await grantScoped();
  assert.deepEqual((await decide("View")).matchedGrantIds, [view.id]);
  for (const action of ["Contribute", "Manage", "Approve"] as const) {
    assert.equal((await decide(action)).reasonCode, "authority-not-granted");
    await assert.rejects(grantScoped(action), { code: "AUTHMOD_BEVERAGE_SCOPE_INVALID" });
  }
  assert.deepEqual(await menu(), before);
  assert.deepEqual(await repository.listSiteAssignments(identity.id), []);
});

test("the audited grant accepts one full bounded inventory and rejects invalid or delegated scopes before writing", async () => {
  const { repository, identity, decide, grantNormal, grantScoped } = await fixture();
  const denied = { code: "AUTHMOD_BEVERAGE_SCOPE_INVALID" };
  await assert.rejects(grantScoped(), denied);
  await grantNormal();
  const ids = Array.from({ length: MAX_BEVERAGE_OPLOC_SCOPE }, (_, index) => `oploc:fixture-${String(index).padStart(3, "0")}-${"x".repeat(130)}`);
  for (const id of ids) repository.oplocs.set(id, { id, label: "Inventory fixture", active: true });
  const auditCount = repository.audits.length;
  for (const scope of [[], [site, site], [site, legacySite], [...ids, site]]) await assert.rejects(grantScoped("View", scope), denied);
  assert.equal(repository.audits.length, auditCount);
  const grant = await grantScoped("View", [...ids].reverse());
  assert.match(grant.id, /^authority:beverage:[a-f0-9]{64}$/);
  assert.deepEqual(grant.scope, { kind: "oploc", ids });
  assert.equal(repository.audits.length, auditCount + 1);
  const audit = repository.audits.at(-1);
  assert.equal(audit?.targetId, grant.id);
  assert.equal(audit?.actorPrincipalId, actor.id);
  assert.deepEqual(audit?.scope, grant.scope);
  assert.equal((await decide("View", ids)).allowed, true);
  assert.equal((await decide("View", [otherSite])).allowed, false);
  assert.equal((await grantScoped("View", ids)).id, grant.id);
  assert.deepEqual(await repository.listSiteAssignments(identity.id), []);
  await assert.rejects(createDelegation(repository, {
    delegatorId: identity.id, delegateId: "fixture:delegate", sourceGrantId: grant.id, action: "View",
    scope: { kind: "oploc", ids: [ids[0]] }, effectiveFrom: "2026-11-07T00:00:00Z", effectiveTo: "2026-11-08T00:00:00Z",
    actor, reason: "Fictional prohibited delegation.",
  }), { code: "AUTHMOD_DELEGATION_SOURCE_INVALID" });
});

test("generic Hub access keeps Beverage unavailable and preserves existing Full Access", async () => {
  const { repository, identity, grantNormal, grantSite } = await fixture();
  await grantNormal();
  await grantSite();
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor, reason: "Fictional legacy Full Access." });
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName };
  assert.equal((await resolveUserAccess(repository, { principal, appId: app.appId })).reasonCode, "app-disabled");
  assert.equal((await evaluateAuthority(repository, {
    principal, appId: app.appId, resource: app.standardResource, action: "View", scope: { kind: "oploc", ids: [site] },
  })).reasonCode, "app-disabled");
  assert.equal((await resolveUserAccess(repository, { principal, appId: "menu-planning", oplocId: site })).allowed, true);
});
