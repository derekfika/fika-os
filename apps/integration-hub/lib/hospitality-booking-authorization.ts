import type { AuthPrincipal, AuthModRepository, AuthorityGrant } from "./authmod-core";
import { resolveUserAccess } from "./authmod-core/evaluator";
import { HOSPITALITY_BOOKING_ADMIN, idempotentId, isEffective } from "./authmod-core/model";
import type { CanonicalBooking } from "./hospitality-booking-service";

export async function assertHospitalityBookingMutationAccess(
  repository: AuthModRepository,
  principal: AuthPrincipal,
  booking: Pick<CanonicalBooking, "service">,
  elevated = false,
) {
  if (elevated) return;
  const oplocId = String(booking.service?.oplocId || "").trim();
  if (!oplocId) throw Object.assign(new Error("This Booking has no governed service OPLOC."), { status: 403 });
  const decision = await resolveUserAccess(repository, {
    principal,
    appId: "hospitality-booking",
    oplocId,
  });
  if (!decision.allowed) throw Object.assign(new Error("You are not authorised to change this Hospitality Booking."), { status: 403, code: "AUTHMOD_HOSPITALITY_BOOKING_DENIED", decision });
}

export type HospitalityAdminAuthority = {
  source: "explicit-company-grant";
  identityId: string;
  identityVersion: number;
  oplocId: string;
  grantId: string;
  grantVersion: number;
};

function isDirectCompanyGrant(grant: AuthorityGrant, identityId: string) {
  return grant.id === idempotentId("authority", "interactive", identityId, "hospitality-booking", HOSPITALITY_BOOKING_ADMIN, "Manage", "organisation") &&
    grant.appId === "hospitality-booking" && grant.resource === HOSPITALITY_BOOKING_ADMIN && grant.action === "Manage" &&
    grant.subjectType === "interactive" && grant.subjectId === identityId &&
    grant.provenance === "explicit-special-authority" && !grant.delegationSourceGrantId &&
    grant.scope.kind === "organisation" && grant.scope.ids.length === 0 &&
    Number.isSafeInteger(grant.version) && grant.version > 0 && isEffective(grant);
}

/**
 * Resolve Hospitality Admin from the live AUTHMOD identity and direct company grant.
 * In amendment transactions, identity, app admission, site and grant reads use the
 * supplied transaction repository so disabling the account, removing app
 * admission or revoking the grant takes effect before the booking write can commit.
 */
export async function resolveHospitalityBookingAdmin(
  repository: AuthModRepository,
  principal: AuthPrincipal,
  sourceOplocId?: string,
): Promise<HospitalityAdminAuthority | undefined> {
  if (principal.type !== "interactive" || !sourceOplocId) return;
  const redirects = await repository.listOplocRedirects();
  const visited = new Set<string>();
  let oplocId: string | undefined = sourceOplocId.trim();
  while (oplocId && Object.hasOwn(redirects, oplocId)) {
    if (visited.has(oplocId) || visited.size >= 10) return;
    visited.add(oplocId);
    oplocId = redirects[oplocId];
  }
  if (!oplocId || !await repository.getActiveOploc(oplocId)) return;

  const identity = await repository.getIdentity(principal.id);
  // Legend linkage is separate from the authenticated Firebase-to-AUTHMOD binding.
  // A live interactive principal already resolves to this identity through the session.
  if (!identity || identity.id !== principal.id || identity.identityKind !== "person" || !isEffective(identity)) return;
  const app = await repository.getApplication("hospitality-booking");
  if (!app?.enabled || app.scopeModel === "none") return;

  // Normal app admission includes Superuser access. The separate grant below
  // is still required for late amendments.
  if (identity.fullAccess !== true) {
    const appAssignmentId = idempotentId("app-assignment", identity.id, "hospitality-booking");
    const appAssignment = await repository.getAppAssignment(appAssignmentId);
    if (!appAssignment || appAssignment.identityId !== identity.id || appAssignment.appId !== "hospitality-booking" || !isEffective(appAssignment)) return;
  }

  // Resolve the deterministic company-grant ID directly, avoiding a collection scan
  // and ensuring transaction-backed callers recheck current authority, not a package cache.
  const grantId = idempotentId("authority", "interactive", identity.id, "hospitality-booking", HOSPITALITY_BOOKING_ADMIN, "Manage", "organisation");
  const grant = await repository.getAuthorityGrant(grantId);
  if (!grant || !isDirectCompanyGrant(grant, identity.id)) return;
  return { source: "explicit-company-grant", identityId: identity.id, identityVersion: identity.version, oplocId, grantId: grant.id, grantVersion: grant.version };
}

export async function assertHospitalityBookingReadAccess(repository: AuthModRepository, principal: AuthPrincipal, booking: Pick<CanonicalBooking, "service">, elevated = false) {
  if (elevated) return;
  const oplocId = String(booking.service?.oplocId || "").trim();
  if (!oplocId) throw Object.assign(new Error("This Booking has no governed service OPLOC."), { status: 403 });
  const decision = await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId });
  if (decision.allowed || await resolveHospitalityBookingAdmin(repository, principal, oplocId)) return;
  throw Object.assign(new Error("You are not authorised to view this Hospitality Booking."), { status: 403, code: "AUTHMOD_HOSPITALITY_BOOKING_DENIED", decision });
}

export async function requireHospitalityBookingAdmin(repository: AuthModRepository, principal: AuthPrincipal, sourceOplocId?: string) {
  const authority = await resolveHospitalityBookingAdmin(repository, principal, sourceOplocId);
  if (!authority) throw Object.assign(new Error("An effective company-wide Hospitality Admin authority is required for this booking."), { status: 403, code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  return authority;
}
