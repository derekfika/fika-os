import type { AuthPrincipal, AppAssignment, ApplicationRegistryEntry, AuthorityGrant, EffectivePeriod, SiteAssignment } from "./model";
import { idempotentId, isEffective, now } from "./model";
import { appendAudit } from "./audit";
import type { AuthModRepository } from "./repository";

function period(input?: EffectivePeriod) { return { ...(input?.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}), ...(input?.effectiveTo ? { effectiveTo: input.effectiveTo } : {}) }; }
function standardGrant(app: ApplicationRegistryEntry, identityId: string, action: AuthorityGrant["action"], bundleId: string, scope: AuthorityGrant["scope"], actor: AuthPrincipal, effective?: EffectivePeriod): AuthorityGrant {
  const timestamp = now();
  return { id: idempotentId("grant", identityId, app.appId, action, scope.kind, ...scope.ids), subjectType: "human", subjectId: identityId, appId: app.appId, resource: app.appId + ".normal", action, scope, status: "active", provenance: "standard-app-access", bundleId, ...period(effective), reason: "Standard application access bundle", grantedBy: actor.id, revokedBy: undefined, version: 1, createdAt: timestamp, updatedAt: timestamp };
}
export async function grantStandardApplicationAccess(repository: AuthModRepository, input: { identityId: string; appId: string; actor: AuthPrincipal; effectivePeriod?: EffectivePeriod; scopeIds?: string[]; idempotencyKey?: string }) {
  const app = await repository.getApplication(input.appId); if (!app || !app.enabled) throw Object.assign(new Error("Application is not enabled."), { status: 422 });
  const existing = (await repository.listAppAssignments(input.identityId)).find(value => value.appId === input.appId);
  const timestamp = now(); const bundleId = idempotentId("standard-app-access", input.identityId, input.appId);
  const assignment: AppAssignment = { id: idempotentId("app-assignment", input.identityId, input.appId), identityId: input.identityId, appId: input.appId, status: "active", bundleId, source: "standard-app-access", reason: "Standard application access", grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp, ...period(input.effectivePeriod) };
  const scope = app.scopeModel === "none" ? { kind: "organisation" as const, ids: [] } : { kind: "oploc" as const, ids: [...(input.scopeIds || [])].sort() };
  const existingGrants = await repository.listAuthorityGrants(input.identityId, "human");
  const grants = app.standardActions.map(action => {
    const prior = existingGrants.find(value => value.id === idempotentId("grant", input.identityId, app.appId, action, scope.kind, ...scope.ids));
    return { ...standardGrant(app, input.identityId, action, bundleId, scope, input.actor, input.effectivePeriod), ...(prior ? { version: prior.version + 1, createdAt: prior.createdAt } : {}) };
  });
  await repository.saveStandardApplicationBundle({ assignment, grants, expectedAssignmentVersion: existing?.version });
  await appendAudit(repository, { actor: input.actor, targetType: "AppAssignment", targetId: assignment.id, action: "standard-application-access-granted", afterState: { assignment, grantIds: grants.map(value => value.id) }, provenance: "standard-app-access", outcome: "committed", scope, idempotencyKey: input.idempotencyKey });
  return { assignment, grants, bundleId };
}
export async function revokeStandardApplicationAccess(repository: AuthModRepository, input: { identityId: string; appId: string; actor: AuthPrincipal; reason?: string; idempotencyKey?: string }) {
  const assignment = (await repository.listAppAssignments(input.identityId)).find(value => value.appId === input.appId);
  if (!assignment) return { revoked: false, grantIds: [] as string[] };
  const timestamp = now(); const nextAssignment = { ...assignment, status: "revoked" as const, revokedBy: input.actor.id, reason: input.reason, version: assignment.version + 1, updatedAt: timestamp };
  const grants = await repository.listAuthorityGrants(input.identityId, "human");
  const standard = grants.filter(value => value.appId === input.appId && value.provenance === "standard-app-access" && value.bundleId === assignment.bundleId && isEffective(value));
  for (const grant of standard) await repository.saveAuthorityGrant({ ...grant, status: "revoked", revokedBy: input.actor.id, reason: input.reason, version: grant.version + 1, updatedAt: timestamp }, grant.version);
  await repository.saveAppAssignment(nextAssignment, assignment.version);
  await appendAudit(repository, { actor: input.actor, targetType: "AppAssignment", targetId: assignment.id, action: "standard-application-access-revoked", beforeState: assignment, afterState: { assignment: nextAssignment, revokedGrantIds: standard.map(value => value.id) }, provenance: "standard-app-access", outcome: "revoked", scope: { kind: "organisation", ids: [] }, idempotencyKey: input.idempotencyKey });
  return { revoked: true, grantIds: standard.map(value => value.id) };
}
export async function assignSite(repository: AuthModRepository, input: { identityId: string; oplocId: string; actor: AuthPrincipal; effectivePeriod?: EffectivePeriod; reason?: string }) {
  const activeOplocs = await repository.listActiveOplocs(); if (!activeOplocs.some(value => value.id === input.oplocId)) throw Object.assign(new Error("Unknown or inactive OPLOC."), { status: 422 });
  const id = idempotentId("site-assignment", input.identityId, input.oplocId); const prior = await repository.getSiteAssignment(id); const timestamp = now();
  const assignment: SiteAssignment = { id, identityId: input.identityId, oplocId: input.oplocId, status: "active", source: "manual-override", reason: input.reason, grantedBy: input.actor.id, version: (prior?.version || 0) + 1, createdAt: prior?.createdAt || timestamp, updatedAt: timestamp, ...period(input.effectivePeriod) };
  await repository.saveSiteAssignment(assignment, prior?.version);
  await appendAudit(repository, { actor: input.actor, targetType: "SiteAssignment", targetId: id, action: "site-assignment-granted", beforeState: prior, afterState: assignment, provenance: "manual-override", outcome: "committed", scope: { kind: "oploc", ids: [input.oplocId] } });
  return assignment;
}
