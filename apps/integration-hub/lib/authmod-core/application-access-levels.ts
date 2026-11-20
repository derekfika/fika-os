import { auditEvent } from "./audit";
import { idempotentId, isEffective, now, type AppAssignment, type ApplicationAccessLevel, type AppOplocScope, type AuthModAction, type AuthPrincipal, type AuthorityGrant } from "./model";
import type { AuthModRepository } from "./repository";

const APPLICATION_ACCESS_POLICIES = {
  "menu-planning": { resource: "menu-planning.normal", manageActions: ["View", "Contribute", "Manage"] as const },
} satisfies Record<string, { resource: string; manageActions: readonly AuthModAction[] }>;

export function applicationAccessPolicy(appId: string) {
  return Object.hasOwn(APPLICATION_ACCESS_POLICIES, appId) ? APPLICATION_ACCESS_POLICIES[appId as keyof typeof APPLICATION_ACCESS_POLICIES] : undefined;
}

export const applicationAssignmentId = (identityId: string, appId: string) => idempotentId("app-assignment", identityId, appId);

/** A configured level is authoritative even when its assignment is revoked. */
export function configuredApplicationAssignment(assignments: AppAssignment[], identityId: string, appId: string) {
  if (!applicationAccessPolicy(appId)) return undefined;
  return assignments.find(value => value.id === applicationAssignmentId(identityId, appId) &&
    value.identityId === identityId && value.appId === appId && value.permissionLevel !== undefined);
}

export type ApplicationAccessLevelCommand = {
  identityId: string;
  appId: string;
  level: ApplicationAccessLevel;
  expectedVersion: number;
  actor: AuthPrincipal;
  reason: string;
};

export async function setApplicationAccessLevel(repository: AuthModRepository, input: ApplicationAccessLevelCommand) {
  const policy = applicationAccessPolicy(input.appId);
  const app = policy ? await repository.getApplication(input.appId) : undefined;
  if (!policy || !app?.enabled || app.standardResource !== policy.resource || !policy.manageActions.every(action => app.standardActions.includes(action))) {
    throw Object.assign(new Error("This application has no enabled permission-level policy."), { status: 422, code: "AUTHMOD_ACCESS_LEVEL_UNSUPPORTED" });
  }
  if (!input.reason.trim()) throw Object.assign(new Error("A reason is required for permission-level changes."), { status: 422, code: "AUTHMOD_REASON_REQUIRED" });
  await repository.saveApplicationAccessLevel(input);
}

/** Plan from the state read by the write transaction. */
export function planApplicationAccessLevel(input: ApplicationAccessLevelCommand, prior: AppAssignment | undefined, grants: AuthorityGrant[], appScopes: AppOplocScope[]) {
  if ((prior?.version ?? 0) !== input.expectedVersion) {
    throw Object.assign(new Error("Application access changed since it was opened. Refresh and review before saving."), { status: 409, code: "AUTHMOD_VERSION_CONFLICT" });
  }
  const policy = applicationAccessPolicy(input.appId);
  if (!policy) throw new Error("Application permission-level policy is unavailable.");
  const timestamp = now();
  const version = input.expectedVersion + 1;
  const bundleId = idempotentId("application-access-level", input.identityId, input.appId, String(version));
  const assignment: AppAssignment = {
    id: applicationAssignmentId(input.identityId, input.appId), identityId: input.identityId, appId: input.appId,
    status: input.level === "none" ? "revoked" : "active", permissionLevel: input.level,
    bundleId, source: "standard-app-access", accessType: "permanent", reason: input.reason,
    grantedBy: input.actor.id, ...(input.level === "none" ? { revokedBy: input.actor.id } : {}),
    version, createdAt: prior?.createdAt || timestamp, updatedAt: timestamp,
  };
  const superseded = grants.filter(grant => grant.subjectType === "interactive" && grant.subjectId === input.identityId &&
    grant.appId === input.appId && grant.resource === policy.resource && grant.status === "active" &&
    (policy.manageActions as readonly AuthModAction[]).includes(grant.action));
  const revoked: AuthorityGrant[] = superseded.map(grant => ({
    ...grant, status: "revoked", revokedBy: input.actor.id, version: grant.version + 1, updatedAt: timestamp,
  }));
  const actions = input.level === "manage" ? policy.manageActions : input.level === "view" ? ["View"] as const : [];
  const issued: AuthorityGrant[] = actions.map(action => ({
    id: idempotentId("grant", bundleId, action), subjectType: "interactive", subjectId: input.identityId,
    appId: input.appId, resource: policy.resource, action, scope: { kind: "organisation", ids: [] },
    status: "active", provenance: "standard-app-access", bundleId, accessType: "permanent",
    reason: input.reason, grantedBy: input.actor.id, version: 1, createdAt: timestamp, updatedAt: timestamp,
  }));
  const revokedScopes: AppOplocScope[] = input.level === "none" ? appScopes
    .filter(scope => scope.appId === input.appId && scope.identityId === input.identityId && scope.status === "active")
    .map(scope => ({ ...scope, status: "revoked", revokedBy: input.actor.id, version: scope.version + 1, updatedAt: timestamp })) : [];
  const audit = auditEvent({
    actor: input.actor, targetType: "AuthIdentity", targetId: input.identityId, action: "application-access-level-changed",
    beforeState: { assignment: prior ?? null, grants: superseded, appOplocScopes: appScopes.filter(scope => revokedScopes.some(revokedScope => revokedScope.id === scope.id)) },
    afterState: { assignment, issued, revoked, revokedScopes }, provenance: "standard-app-access",
    outcome: input.level === "none" ? "revoked" : "committed",
  });
  return { assignment, issued, revoked, revokedScopes, audit };
}

export function isCurrentLevelGrant(grant: AuthorityGrant, assignment: AppAssignment, resource: string, action: AuthModAction) {
  return grant.subjectType === "interactive" && grant.subjectId === assignment.identityId && grant.appId === assignment.appId &&
    grant.resource === resource && grant.action === action && grant.scope.kind === "organisation" &&
    grant.provenance === "standard-app-access" && Boolean(assignment.bundleId) && grant.bundleId === assignment.bundleId && isEffective(grant);
}
