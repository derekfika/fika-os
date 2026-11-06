import type { AuthPrincipal, AuthModRepository } from "./authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "./authmod-core/evaluator";
import { HOSPITALITY_BOOKING_ADMIN, isEffective, type AuthorityGrant } from "./authmod-core/model";
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

export type HospitalityAdminAuthority = { grantId: string; grantVersion: number; identityId: string; oplocId: string };

export async function resolveHospitalityBookingAdmin(repository: AuthModRepository, principal: AuthPrincipal, sourceOplocId?: string, context = createAuthModEvaluationContext(repository, principal)): Promise<HospitalityAdminAuthority | undefined> {
  if (principal.type !== "interactive" || !sourceOplocId) return;
  const identity = await context.identity();
  if (identity?.id !== principal.id || identity.identityKind !== "person" || !isEffective(identity)) return;
  const isGrant = (grant: AuthorityGrant) => grant.appId === "hospitality-booking" &&
    grant.resource === HOSPITALITY_BOOKING_ADMIN && grant.action === "Manage" &&
    grant.subjectType === "interactive" && grant.subjectId === principal.id &&
    grant.provenance === "explicit-special-authority" && !grant.delegationSourceGrantId &&
    grant.scope.kind === "oploc" && Number.isSafeInteger(grant.version) && grant.version > 0 &&
    (!grant.effectiveFrom || Number.isFinite(Date.parse(grant.effectiveFrom))) &&
    (!grant.effectiveTo || Number.isFinite(Date.parse(grant.effectiveTo))) && isEffective(grant);
  const grants = (await context.grants()).filter(isGrant);
  if (!grants.length) return;
  const liveIdentity = await repository.getIdentity(principal.id);
  if (liveIdentity?.id !== principal.id || liveIdentity.identityKind !== "person" || !isEffective(liveIdentity)) return;
  const app = await context.application("hospitality-booking");
  if (!app?.enabled || app.scopeModel === "none") return;
  const admission = await resolveUserAccess(repository, { principal, appId: "hospitality-booking" }, context);
  if (!admission.allowed) return;
  if (!liveIdentity.fullAccess) {
    const appAssignment = (await context.appAssignments()).find(item => item.identityId === principal.id && item.appId === "hospitality-booking" && isEffective(item));
    const liveAssignment = appAssignment && await repository.getAppAssignment(appAssignment.id);
    if (!liveAssignment || liveAssignment.identityId !== principal.id || liveAssignment.appId !== "hospitality-booking" || !isEffective(liveAssignment)) return;
  }
  const redirects = await repository.listOplocRedirects();
  const resolveSite = (id: string) => {
    const visited = new Set<string>();
    while (id && visited.size < 10 && !visited.has(id)) {
      if (!Object.hasOwn(redirects, id)) return id;
      visited.add(id);
      id = redirects[id];
    }
    return undefined;
  };
  const oplocId = resolveSite(sourceOplocId);
  if (!oplocId || !await context.activeOploc(oplocId)) return;
  const assignment = (await context.siteAssignments()).find(site => site.identityId === principal.id && isEffective(site) && resolveSite(site.oplocId) === oplocId);
  const liveSite = assignment && await repository.getSiteAssignment(assignment.id);
  if (!liveSite || liveSite.identityId !== principal.id || !isEffective(liveSite) || resolveSite(liveSite.oplocId) !== oplocId) return;
  const matches = (grant: AuthorityGrant) => grant.scope.ids.some(id => resolveSite(id) === oplocId);
  for (const grant of grants.filter(matches).sort((a, b) => a.id.localeCompare(b.id))) {
    const current = await repository.getAuthorityGrant(grant.id);
    if (current && current.version === grant.version && isGrant(current) && matches(current)) {
      return { grantId: current.id, grantVersion: current.version, identityId: principal.id, oplocId };
    }
  }
}

export async function requireHospitalityBookingAdmin(repository: AuthModRepository, principal: AuthPrincipal, sourceOplocId?: string) {
  const authority = await resolveHospitalityBookingAdmin(repository, principal, sourceOplocId);
  if (!authority) throw Object.assign(new Error("An effective Hospitality Admin grant is required at this booking's OPLOC."), { status: 403, code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  return authority;
}
