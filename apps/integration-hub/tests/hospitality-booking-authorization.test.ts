import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAuthModRepository, V1_APPLICATIONS, assignSite, createAuthIdentity, grantStandardApplicationAccess } from "../lib/authmod-core";
import { assertHospitalityBookingMutationAccess } from "../lib/hospitality-booking-authorization";

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
