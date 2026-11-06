import assert from "node:assert/strict";
import test from "node:test";
import { HOSPITALITY_BOOKING_ADMIN, MemoryAuthModRepository, V1_APPLICATIONS, assignSite, createAuthIdentity, grantAuthority, grantStandardApplicationAccess, revokeAuthority, setFullAccess } from "../lib/authmod-core";
import { assertHospitalityBookingMutationAccess, assertHospitalityBookingReadAccess, requireHospitalityBookingAdmin } from "../lib/hospitality-booking-authorization";

const admin = { type: "interactive" as const, id: "actor:admin", displayName: "AUTHMOD Operator", email: "operator@example.test" };
const locations = [
  { id: "oploc:mnk", label: "MNK", active: true },
  { id: "oploc:angel", label: "Angel Court", active: true },
];

async function person(repository: MemoryAuthModRepository, key: string) {
  return createAuthIdentity(repository, { actor: admin, displayName: `Staff ${key}`, externalProvider: "firebase", externalUid: `uid:${key}`, legendId: `legend:${key}`, provenance: "migration" });
}

test("ordinary Hospitality access remains site scoped for reads and mutations", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "manager");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality manager access." });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:mnk", actor: admin, reason: "MNK site access." });

  await assertHospitalityBookingReadAccess(repository, principal, { service: { oplocId: "oploc:mnk" } as never });
  await assertHospitalityBookingMutationAccess(repository, principal, { service: { oplocId: "oploc:mnk" } as never });
  await assert.rejects(() => assertHospitalityBookingReadAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never }), { status: 403 });
  await assert.rejects(() => assertHospitalityBookingMutationAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never }), { status: 403, code: "AUTHMOD_HOSPITALITY_BOOKING_DENIED" });
});

test("active Superuser has implicit company authority even without Legend linkage or assignments", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "Staff superuser", externalProvider: "firebase", externalUid: "uid:superuser", provenance: "migration" });
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor: admin, reason: "Approved Superuser test" });

  const first = await requireHospitalityBookingAdmin(repository, principal, "oploc:mnk");
  const second = await requireHospitalityBookingAdmin(repository, principal, "oploc:angel");
  assert.equal(first.source, "superuser");
  assert.equal(first.grantId, undefined);
  assert.equal(first.identityVersion, repository.identities.get(identity.id)?.version);
  assert.equal(second.oplocId, "oploc:angel");
  assert.equal(repository.grants.size, 0);
  assert.equal(repository.appAssignments.size, 0);
  assert.equal(repository.siteAssignments.size, 0);

  repository.oplocs.set("oploc:new-site", { id: "oploc:new-site", label: "New site", active: true });
  assert.equal((await requireHospitalityBookingAdmin(repository, principal, "oploc:new-site")).oplocId, "oploc:new-site");
  repository.oplocs.set("oploc:inactive", { id: "oploc:inactive", label: "Inactive", active: false });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:inactive"), { status: 403 });

  await setFullAccess(repository, { identityId: identity.id, fullAccess: false, actor: admin, reason: "Remove Superuser for revocation test" });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403, code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
});

test("explicit company grant needs normal app admission but no OPLOC assignment and revokes or expires cleanly", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "company-admin");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  const input = { actor: admin, subjectType: "interactive" as const, subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage" as const, scope: { kind: "organisation" as const, ids: [] }, reason: "Central management booking cover" };

  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 });
  const expired = await grantAuthority(repository, { ...input, effectivePeriod: { effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2021-01-01T00:00:00Z" } });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 }, "grant alone does not bypass app admission");
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality application admission" });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 }, "expired company grants remain ineffective");
  assert.equal(repository.grants.get(expired.id)?.status, "active");
  assert.equal(repository.grants.get(expired.id)?.effectiveTo, "2021-01-01T00:00:00Z");
  await grantAuthority(repository, input);
  const allowed = await requireHospitalityBookingAdmin(repository, principal, "oploc:mnk");
  assert.equal(allowed.source, "explicit-company-grant");
  assert.equal(allowed.grantVersion, 2);
  assert.equal(repository.siteAssignments.size, 0);
  await assertHospitalityBookingReadAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never });

  await revokeAuthority(repository, { actor: admin, grantId: allowed.grantId!, reason: "Cover ended" });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:angel"), { status: 403 });
});

test("company grants reject site scopes and legacy site grants do not widen", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "legacy");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality application admission" });
  const base = { actor: admin, subjectType: "interactive" as const, subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage" as const, reason: "Explicit company authority" };
  await assert.rejects(() => grantAuthority(repository, { ...base, scope: { kind: "oploc", ids: ["oploc:mnk"] } }), { status: 422, code: "AUTHMOD_HOSPITALITY_ADMIN_SCOPE" });

  // Simulate a historical PR #426 grant already in storage; it remains site-scoped
  // and is never interpreted as company authority by the current resolver.
  repository.grants.set("legacy-site-grant", { id: "legacy-site-grant", subjectType: "interactive", subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage", scope: { kind: "oploc", ids: ["oploc:mnk"] }, status: "active", provenance: "explicit-special-authority", version: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:angel"), { status: 403 });
});

test("operational and inactive identities cannot use implicit or explicit authority", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "inactive");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor: admin, reason: "Test fixture" });
  await repository.saveIdentity({ ...repository.identities.get(identity.id)!, status: "inactive", version: repository.identities.get(identity.id)!.version + 1 });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 });

  const operational = await createAuthIdentity(repository, { actor: admin, displayName: "Shared kitchen account", identityKind: "operational", externalProvider: "firebase", externalUid: "uid:operational", provenance: "migration" });
  await repository.saveIdentity({ ...repository.identities.get(operational.id)!, fullAccess: true });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, { type: "interactive", id: operational.id, displayName: operational.displayName }, "oploc:mnk"), { status: 403 });
});
