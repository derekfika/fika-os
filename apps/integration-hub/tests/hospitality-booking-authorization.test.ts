import assert from "node:assert/strict";
import test from "node:test";
import { HOSPITALITY_BOOKING_ADMIN, MemoryAuthModRepository, V1_APPLICATIONS, assignSite, createAuthIdentity, grantAuthority, grantStandardApplicationAccess, revokeAuthority, setFullAccess } from "../lib/authmod-core";
import { assertHospitalityBookingMutationAccess, requireHospitalityBookingAdmin } from "../lib/hospitality-booking-authorization";

const admin = { type: "interactive" as const, id: "actor:admin", displayName: "AUTHMOD Operator", email: "operator@example.test" };

test("Hospitality booking mutations use the stored booking OPLOC and preserve cross-site denial", async () => {
  const repository = new MemoryAuthModRepository({
    applications: [...V1_APPLICATIONS],
    oplocs: [
      { id: "oploc:mnk", label: "MNK", active: true },
      { id: "oploc:angel", label: "Angel Court", active: true },
    ],
  });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "MNK Manager", email: "mnk-manager@example.test", externalProvider: "firebase", externalUid: "uid:mnk-manager", provenance: "migration" });
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Hospitality manager access." });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:mnk", actor: admin, reason: "MNK site access." });

  await assertHospitalityBookingMutationAccess(repository, principal, { service: { oplocId: "oploc:mnk" } as never });
  await assert.rejects(
    () => assertHospitalityBookingMutationAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never }),
    (error: { status?: number; code?: string }) => error.status === 403 && error.code === "AUTHMOD_HOSPITALITY_BOOKING_DENIED",
  );
  await assertHospitalityBookingMutationAccess(repository, principal, { service: { oplocId: "oploc:angel" } as never }, true);
});

test("Hospitality Admin needs a current direct grant and assigned active booking OPLOC", async () => {
  const site = "oploc:admin-site";
  const secondSite = "oploc:other-site";
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [
    { id: site, label: "First test site", active: true }, { id: secondSite, label: "Second test site", active: true },
  ] });
  repository.listOplocRedirects = async () => ({ "oploc:old-site": site, "oploc:cycle": "oploc:cycle" });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "Staff fixture", externalProvider: "firebase", externalUid: "staff-fixture", provenance: "migration" });
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor: admin, reason: "Ordinary app assignment" });
  await assignSite(repository, { identityId: identity.id, oplocId: site, actor: admin, reason: "Authorised booking site" });
  const requireGrant = (oploc?: string) => requireHospitalityBookingAdmin(repository, principal, oploc);
  await assert.rejects(requireGrant(site), { status: 403 });
  await setFullAccess(repository, { identityId: identity.id, fullAccess: true, actor: admin, reason: "Fixture superuser check" });
  await assert.rejects(requireGrant(site), { status: 403 });
  const input = { actor: admin, subjectType: "interactive" as const, subjectId: identity.id, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage" as const, reason: "Authorised temporary cover" };
  await assert.rejects(grantAuthority(repository, { ...input, scope: { kind: "organisation", ids: [] } }), { status: 422 });
  await assert.rejects(grantAuthority(repository, { ...input, scope: { kind: "oploc", ids: [secondSite] } }), { status: 422 });
  const scope = { kind: "oploc" as const, ids: [site] };
  await grantAuthority(repository, { ...input, scope, effectivePeriod: { effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2021-01-01T00:00:00Z" } });
  await assert.rejects(requireGrant(site), { status: 403 });
  const grant = await grantAuthority(repository, { ...input, scope });
  assert.deepEqual(await requireGrant("oploc:old-site"), { grantId: grant.id, grantVersion: grant.version, identityId: identity.id, oplocId: site });
  await assert.rejects(requireGrant(secondSite), { status: 403 });
  await assert.rejects(requireGrant("oploc:cycle"), { status: 403 });
  await assert.rejects(requireGrant(), { status: 403 });
  await revokeAuthority(repository, { actor: admin, grantId: grant.id, reason: "Cover ended" });
  await assert.rejects(requireGrant(site), { status: 403 });
});
