import assert from "node:assert/strict";
import test from "node:test";
import { HOSPITALITY_BOOKING_ADMIN, MemoryAuthModRepository, V1_APPLICATIONS, assignSite, createAuthIdentity, grantAuthority, grantStandardApplicationAccess, idempotentId, revokeAuthority, setFullAccess } from "../lib/authmod-core";
import { assertHospitalityBookingMutationAccess, assertHospitalityBookingReadAccess, requireHospitalityBookingAdmin } from "../lib/hospitality-booking-authorization";
import { ROTATIONS_AUTHORITY } from "../../shared/hospitality-rotations";

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

test("Superuser app admission works without an assignment but still needs the explicit company grant", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "Staff superuser", externalProvider: "firebase", externalUid: "uid:superuser", provenance: "migration" });
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor: admin, reason: "Approved Superuser test" });

  assert.deepEqual(await repository.listAppAssignments(identity.id), []);
  await assertHospitalityBookingReadAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403, code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  const grant = await grantAuthority(repository, { actor: admin, subjectType: "interactive", subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Central management booking cover" });
  assert.equal((await requireHospitalityBookingAdmin(repository, principal, "oploc:mnk")).grantId, grant.id);

  await setFullAccess(repository, { identityId: identity.id, fullAccess: false, actor: admin, reason: "End Superuser access" });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403, code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
});

test("explicit company grant needs normal app admission but no OPLOC assignment and revokes or expires cleanly", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "company-admin");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  const input = { actor: admin, subjectType: "interactive" as const, subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage" as const, scope: { kind: "organisation" as const, ids: [] }, reason: "Central management booking cover" };

  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 });
  await grantAuthority(repository, input);
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 }, "grant alone does not bypass app admission");
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality application admission" });
  const expired = await grantAuthority(repository, { ...input, effectivePeriod: { effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2021-01-01T00:00:00Z" } });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 }, "expired company grants remain ineffective");
  assert.equal(repository.grants.get(expired.id)?.status, "active");
  assert.equal(repository.grants.get(expired.id)?.effectiveTo, "2021-01-01T00:00:00Z");
  const grant = await grantAuthority(repository, input);
  repository.oplocs.set("oploc:new-site", { id: "oploc:new-site", label: "New site", active: true });
  repository.oplocs.set("oploc:inactive", { id: "oploc:inactive", label: "Inactive", active: false });
  for (const oplocId of ["oploc:mnk", "oploc:angel", "oploc:new-site"]) {
    assert.deepEqual(await requireHospitalityBookingAdmin(repository, principal, oplocId), {
      source: "explicit-company-grant", identityId: identity.id, identityVersion: identity.version, oplocId, grantId: grant.id, grantVersion: 3,
    });
  }
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:inactive"), { status: 403 });
  assert.equal(repository.siteAssignments.size, 0);
  await assertHospitalityBookingReadAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never });

  await revokeAuthority(repository, { actor: admin, grantId: grant.id, reason: "Cover ended" });
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

test("operational and inactive identities cannot use a company grant", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "inactive");
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality application admission" });
  const grant = await grantAuthority(repository, { actor: admin, subjectType: "interactive", subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Central management cover" });
  await repository.saveIdentity({ ...repository.identities.get(identity.id)!, status: "inactive", version: repository.identities.get(identity.id)!.version + 1 });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, principal, "oploc:mnk"), { status: 403 });

  const operational = await createAuthIdentity(repository, { actor: admin, displayName: "Shared kitchen account", identityKind: "operational", externalProvider: "firebase", externalUid: "uid:operational", provenance: "migration" });
  await repository.saveIdentity({ ...repository.identities.get(operational.id)!, fullAccess: true });
  await grantStandardApplicationAccess(repository, { identityId: operational.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality application admission" });
  const input = { actor: admin, subjectType: "interactive" as const, subjectId: operational.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage" as const, scope: { kind: "organisation" as const, ids: [] }, reason: "Central management cover" };
  await assert.rejects(() => grantAuthority(repository, input), { code: "AUTHMOD_PERSON_REQUIRED" });
  const grantId = idempotentId("authority", "interactive", operational.id, "hospitality-booking", HOSPITALITY_BOOKING_ADMIN, "Manage", "organisation");
  repository.grants.set(grantId, { ...grant, id: grantId, subjectId: operational.id });
  await assert.rejects(() => requireHospitalityBookingAdmin(repository, { type: "interactive", id: operational.id, displayName: operational.displayName }, "oploc:mnk"), { status: 403 });
});

test("Hospitality Rotations grants require an interactive person and organisation scope", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: locations });
  const identity = await person(repository, "rotation-author");
  const base = { actor: admin, subjectType: "interactive" as const, subjectId: identity.id, ...ROTATIONS_AUTHORITY, action: "Manage" as const, reason: "Hospitality rotation authoring" };
  const grant = await grantAuthority(repository, { ...base, scope: { kind: "organisation", ids: [] } });
  assert.equal(grant.resource, "hospitality.rotations");
  await assert.rejects(() => grantAuthority(repository, { ...base, subjectType: "service", scope: { kind: "organisation", ids: [] } }), { code: "AUTHMOD_PERSON_REQUIRED" });
  await assert.rejects(() => grantAuthority(repository, { ...base, scope: { kind: "oploc", ids: ["oploc:mnk"] } }), { code: "AUTHMOD_ORGANISATION_SCOPE_REQUIRED" });
});
