import type { AuthPrincipal, AppAssignment, ApplicationRegistryEntry, AuthorityGrant, EffectivePeriod, SiteAssignment } from "./model";
import { idempotentId, isEffective, now } from "./model";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

function period(input?: EffectivePeriod) { return { ...(input?.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}), ...(input?.effectiveTo ? { effectiveTo: input.effectiveTo } : {}) }; }
function standardGrant(app: ApplicationRegistryEntry, identityId: string, action: AuthorityGrant["action"], bundleId: string, actor: AuthPrincipal, effective?: EffectivePeriod): AuthorityGrant {
  const timestamp = now();
  return { id: idempotentId("grant", identityId, app.appId, action), subjectType: "interactive", subjectId: identityId, appId: app.appId, resource: app.standardResource, action, scope: { kind: "organisation", ids: [] }, status: "active", provenance: "standard-app-access", bundleId, ...period(effective), reason: "Standard application access bundle", grantedBy: actor.id, revokedBy: undefined, version: 1, createdAt: timestamp, updatedAt: timestamp };
}
export async function grantStandardApplicationAccess(repository: AuthModRepository, input: { identityId: string; appId: string; actor: AuthPrincipal; effectivePeriod?: EffectivePeriod; idempotencyKey?: string }) {
  const app = await repository.getApplication(input.appId); if (!app || !app.enabled) throw Object.assign(new Error("Application is not enabled."), { status: 422 });
  const existing = (await repository.listAppAssignments(input.identityId)).find(value => value.appId === input.appId);
  const timestamp = now(); const bundleId = idempotentId("standard-app-access", input.identityId, input.appId);
  const assignment: AppAssignment = { id: idempotentId("app-assignment", input.identityId, input.appId), identityId: input.identityId, appId: input.appId, status: "active", bundleId, source: "standard-app-access", reason: "Standard application access", grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp, ...period(input.effectivePeriod) };
  const existingGrants = await repository.listAuthorityGrants(input.identityId, "interactive");
  const grants = app.standardActions.map(action => {
    const prior = existingGrants.find(value => value.id === idempotentId("grant", input.identityId, app.appId, action));
    return { ...standardGrant(app, input.identityId, action, bundleId, input.actor, input.effectivePeriod), ...(prior ? { version: prior.version + 1, createdAt: prior.createdAt } : {}) };
  });
  const audit = auditEvent({ actor: input.actor, targetType: "AppAssignment", targetId: assignment.id, action: "standard-application-access-granted", afterState: { assignment, grantIds: grants.map(value => value.id) }, provenance: "standard-app-access", outcome: "committed", scope: { kind: "organisation", ids: [] }, idempotencyKey: input.idempotencyKey });
  await repository.saveStandardApplicationBundle({ assignment, grants, audit, expectedAssignmentVersion: existing?.version });
  return { assignment, grants, bundleId };
}
export async function revokeStandardApplicationAccess(repository: AuthModRepository, input: { identityId: string; appId: string; actor: AuthPrincipal; reason?: string; idempotencyKey?: string }) {
  const assignment = (await repository.listAppAssignments(input.identityId)).find(value => value.appId === input.appId);
  if (!assignment) return { revoked: false, grantIds: [] as string[] };
  const timestamp = now(); const nextAssignment = { ...assignment, status: "revoked" as const, revokedBy: input.actor.id, reason: input.reason, version: assignment.version + 1, updatedAt: timestamp };
  const grants = await repository.listAuthorityGrants(input.identityId, "interactive");
  const standard = grants.filter(value => value.appId === input.appId && value.provenance === "standard-app-access" && value.bundleId === assignment.bundleId && isEffective(value));
  const revoked = standard.map(grant => ({ ...grant, status: "revoked" as const, revokedBy: input.actor.id, reason: input.reason, version: grant.version + 1, updatedAt: timestamp }));
  const audit = auditEvent({ actor: input.actor, targetType: "AppAssignment", targetId: assignment.id, action: "standard-application-access-revoked", beforeState: assignment, afterState: { assignment: nextAssignment, revokedGrantIds: standard.map(value => value.id) }, provenance: "standard-app-access", outcome: "revoked", scope: { kind: "organisation", ids: [] }, idempotencyKey: input.idempotencyKey });
  await repository.revokeStandardApplicationBundle({ assignment: nextAssignment, grants: revoked, audit, expectedAssignmentVersion: assignment.version });
  return { revoked: true, grantIds: standard.map(value => value.id) };
}
export async function assignSite(repository: AuthModRepository, input: { identityId: string; oplocId: string; actor: AuthPrincipal; effectivePeriod?: EffectivePeriod; reason?: string; source?: SiteAssignment["source"] }) {
  if (!(await repository.getActiveOploc(input.oplocId))) throw Object.assign(new Error("Unknown or inactive OPLOC."), { status: 422 });
  const id = idempotentId("site-assignment", input.identityId, input.oplocId); const prior = await repository.getSiteAssignment(id); const timestamp = now();
  const assignment: SiteAssignment = { id, identityId: input.identityId, oplocId: input.oplocId, status: "active", source: input.source || "manual-override", reason: input.reason, grantedBy: input.actor.id, version: (prior?.version || 0) + 1, createdAt: prior?.createdAt || timestamp, updatedAt: timestamp, ...period(input.effectivePeriod) };
  const audit = auditEvent({ actor: input.actor, targetType: "SiteAssignment", targetId: id, action: "site-assignment-granted", beforeState: prior, afterState: assignment, provenance: assignment.source, outcome: "committed", scope: { kind: "oploc", ids: [input.oplocId] } });
  await repository.saveSiteAssignmentWithAudit(assignment, audit, prior?.version);
  return assignment;
}
export async function revokeSite(repository: AuthModRepository, input: { identityId: string; oplocId: string; actor: AuthPrincipal; reason?: string }) {
  const id = idempotentId("site-assignment", input.identityId, input.oplocId); const prior = await repository.getSiteAssignment(id); if (!prior) return { revoked: false };
  const next = { ...prior, status: "revoked" as const, revokedBy: input.actor.id, reason: input.reason, version: prior.version + 1, updatedAt: now() };
  const audit = auditEvent({ actor: input.actor, targetType: "SiteAssignment", targetId: id, action: "site-assignment-revoked", beforeState: prior, afterState: next, provenance: prior.source, outcome: "revoked", scope: { kind: "oploc", ids: [input.oplocId] } });
  await repository.saveSiteAssignmentWithAudit(next, audit, prior.version);
  return { revoked: true, assignment: next };
}
