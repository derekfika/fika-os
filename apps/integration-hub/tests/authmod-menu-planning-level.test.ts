import assert from "node:assert/strict";
import test from "node:test";
import { assignSite, createAuthIdentity, createAuthModEvaluationContext, createDelegation, evaluateAuthority, grantAuthority, grantStandardApplicationAccess,
  MemoryAuthModRepository, resolveUserAccess, setApplicationAccessLevel, setFullAccess, V1_APPLICATIONS } from "../lib/authmod-core";
import type { ApplicationAccessLevel, AuthModAction, AuthPrincipal } from "../lib/authmod-core/model";
import { readMenuPlanningAccountPermissions, readMenuPlanningWritePermissions } from "../lib/menu-planning-permissions";

const appId = "menu-planning";
const normal = "menu-planning.normal";
const viewSite = "oploc:menu-fixture";
const otherSite = "oploc:other-fixture";
const actor: AuthPrincipal = { type: "interactive", id: "identity:admin-fixture", identityKind: "person", displayName: "Permission test administrator" };
const reason = "Fixture access was reviewed";
const window = { effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: new Date(Date.now() + 60_000).toISOString() };

async function fixture() {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [
    { id: viewSite, label: "Assigned fixture site", active: true }, { id: otherSite, label: "Other fixture site", active: true },
  ] });
  async function account(name: string) {
    const identity = await createAuthIdentity(repository, { actor, displayName: name, identityKind: "person", provenance: "manual-override" });
    const principal: AuthPrincipal = { type: "interactive", id: identity.id, identityKind: "person", displayName: name };
    await assignSite(repository, { actor, identityId: principal.id, oplocId: viewSite, reason });
    return principal;
  }
  const principal = await account("Fixture one");
  const setLevel = (level: ApplicationAccessLevel, expectedVersion: number) =>
    setApplicationAccessLevel(repository, { actor, appId, identityId: principal.id, level, expectedVersion, reason });
  const allowed = async (action: AuthModAction, oplocId = viewSite, subject = principal, resource = normal) =>
    (await evaluateAuthority(repository, { principal: subject, appId, resource, action, scope: { kind: "oploc", ids: [oplocId] } })).allowed;
  return { repository, principal, account, setLevel, allowed };
}

test("Menu level changes replace legacy writer generations and bound Full Access to assigned sites", async () => {
  const { repository, principal, setLevel, allowed } = await fixture();
  const legacy = await grantStandardApplicationAccess(repository, { actor, identityId: principal.id, appId, reason });
  await setFullAccess(repository, { actor, identityId: principal.id, fullAccess: true, reason });
  const publish = await grantAuthority(repository, { actor, subjectId: principal.id, subjectType: "interactive",
    appId, resource: "menu.publish", action: "Publish", scope: { kind: "organisation", ids: [] }, reason });
  const expired = { ...legacy.grants.find(grant => grant.action === "Manage")!, id: "expired-grant", effectiveTo: "2025-01-01T00:00:00.000Z", bundleId: "historic-bundle" };
  const scheduled = { ...expired, id: "future-grant", effectiveFrom: "2100-01-01T00:00:00.000Z", effectiveTo: "2101-01-01T00:00:00.000Z" };
  await repository.saveAuthorityGrant(expired);
  await repository.saveAuthorityGrant(scheduled);
  assert.equal(await allowed("Manage", otherSite), true);

  await setLevel("view", legacy.assignment.version);
  assert.equal(await allowed("View"), true);
  assert.equal(await allowed("View", otherSite), false);
  assert.equal(await allowed("Manage"), false);
  assert.equal(await allowed("Contribute"), false);
  assert.equal(await allowed("Publish", viewSite, principal, "menu.publish"), false);
  assert.deepEqual(await readMenuPlanningAccountPermissions(repository, principal), {
    effectiveLevel: "view", configuredLevel: "view", version: 2, allOplocs: false, oplocIds: [viewSite], manageOplocIds: [],
  });
  const grants = await repository.listAuthorityGrants(principal.id, "interactive");
  assert.deepEqual(grants.filter(grant => grant.resource === normal && grant.status === "active").map(grant => grant.action), ["View"]);
  assert.ok(grants.filter(grant => [expired.id, scheduled.id].includes(grant.id)).every(grant => grant.status === "revoked" && grant.version === 2));
  assert.deepEqual(await repository.getAuthorityGrant(publish.id), publish);
  assert.equal(repository.audits.at(-1)?.targetId, principal.id);
  assert.equal(repository.audits.at(-1)?.actorPrincipalId, actor.id);

  await grantStandardApplicationAccess(repository, { actor, identityId: principal.id, appId, reason });
  assert.equal(await allowed("Manage"), false);
  await setLevel("manage", 2);
  assert.equal(await allowed("Manage"), true);
  assert.equal(await allowed("Manage", otherSite), false);
  assert.equal(await allowed("Publish", viewSite, principal, "menu.publish"), true);
  assert.equal(await allowed("Publish", otherSite, principal, "menu.publish"), false);
});

test("downgrading revokes effective incoming and outgoing Menu writer delegations", async () => {
  const { repository, principal, account, setLevel, allowed } = await fixture();
  const other = await account("Fixture two");
  const first = await grantStandardApplicationAccess(repository, { actor, identityId: principal.id, appId, reason });
  await grantStandardApplicationAccess(repository, { actor, identityId: other.id, appId, reason });
  const outgoing = await createDelegation(repository, {
    ...window, actor, reason, delegatorId: principal.id, delegateId: other.id,
    sourceGrantId: first.grants.find(grant => grant.action === "Manage")!.id,
    action: "Manage", scope: { kind: "oploc", ids: [viewSite] },
  });
  const otherManage = (await repository.listAuthorityGrants(other.id)).find(grant => grant.provenance === "standard-app-access" && grant.action === "Manage")!;
  const incoming = await createDelegation(repository, {
    ...window, actor, reason, delegatorId: other.id, delegateId: principal.id,
    sourceGrantId: otherManage.id, action: "Manage", scope: { kind: "oploc", ids: [viewSite] },
  });
  await repository.saveAuthorityGrant({ ...otherManage, status: "revoked" }, otherManage.version);
  assert.equal(await allowed("Manage", viewSite, other), true);
  await setLevel("view", first.assignment.version);
  assert.equal((await repository.getAuthorityGrant(incoming.grant.id))?.status, "revoked");
  assert.equal((await repository.getDelegation(outgoing.delegation.id))?.status, "active");
  assert.equal(await allowed("Manage", viewSite, other), false);
  await setLevel("manage", 2);
  assert.equal(await allowed("Manage", viewSite, other), false);
});

test("No access stays authoritative and concurrent stale level commands cannot overwrite each other", async () => {
  const { repository, principal, setLevel, allowed } = await fixture();
  await setFullAccess(repository, { actor, identityId: principal.id, fullAccess: true, reason });
  const results = await Promise.allSettled([setLevel("none", 0), setLevel("manage", 0)]);
  assert.equal(results[0].status, "fulfilled");
  assert.ok(results[1].status === "rejected" && results[1].reason.code === "AUTHMOD_VERSION_CONFLICT");
  assert.equal((await resolveUserAccess(repository, { principal, appId })).allowed, false);
  assert.equal(await allowed("View"), false);
  assert.equal((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: otherSite })).allowed, true);
  assert.equal(repository.audits.filter(audit => audit.action === "application-access-level-changed").length, 1);
  assert.equal((await readMenuPlanningAccountPermissions(repository, principal)).effectiveLevel, "none");
});

test("Manage level provides no special Publish authority and follows governed site redirects", async () => {
  const { repository, principal, setLevel, allowed } = await fixture();
  const site = (await repository.listSiteAssignments(principal.id))[0];
  await repository.saveSiteAssignment({ ...site, oplocId: "oploc:historical-fixture" }, site.version);
  repository.listOplocRedirects = async () => ({ "oploc:historical-fixture": viewSite });
  await setLevel("manage", 0);
  assert.equal(await allowed("Manage"), true);
  assert.equal(await allowed("Manage", otherSite), false);
  assert.equal(await allowed("Publish", viewSite, principal, "menu.publish"), false);
  assert.deepEqual((await readMenuPlanningAccountPermissions(repository, principal)).manageOplocIds, [viewSite]);
});

test("the Hub response intersects Manage and explicit Publish per OPLOC for legacy grants", async () => {
  const { repository, principal, allowed } = await fixture();
  const legacy = await grantStandardApplicationAccess(repository, { actor, identityId: principal.id, appId, reason });
  const manage = legacy.grants.find(grant => grant.action === "Manage")!;
  await repository.saveAuthorityGrant({ ...manage, scope: { kind: "oploc", ids: [viewSite] } }, manage.version);
  const publish = await grantAuthority(repository, { actor, subjectId: principal.id, subjectType: "interactive",
    appId, resource: "menu.publish", action: "Publish", scope: { kind: "organisation", ids: [] }, reason });
  await repository.saveAuthorityGrant({ ...publish, scope: { kind: "oploc", ids: [otherSite] } }, publish.version);
  await assignSite(repository, { actor, identityId: principal.id, oplocId: otherSite, reason });
  assert.equal(await allowed("Publish", otherSite, principal, "menu.publish"), true);
  const readPermissions = () => readMenuPlanningWritePermissions(repository, principal, [viewSite, otherSite], createAuthModEvaluationContext(repository, principal));
  assert.deepEqual(await readPermissions(), { canManageOrganisation: false, canPublishOrganisation: false, manageOplocIds: [viewSite], publishOplocIds: [] });
  await repository.saveAuthorityGrant(publish, publish.version);
  assert.deepEqual(await readPermissions(), { canManageOrganisation: false, canPublishOrganisation: false, manageOplocIds: [viewSite], publishOplocIds: [viewSite] });
});
