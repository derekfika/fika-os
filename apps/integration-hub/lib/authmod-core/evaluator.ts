import type { AuthModRepository } from "./repository";
import { isEffective } from "./model";
import type { AuthPrincipal, AuthorizationDecision, AuthModAction, Scope } from "./model";

function deny(principal: AuthPrincipal, reasonCode: AuthorizationDecision["reasonCode"], extra: Partial<AuthorizationDecision> = {}): AuthorizationDecision {
  return { allowed: false, principalId: principal.id, principalType: principal.type, matchedGrantIds: [], reasonCode, ...extra };
}
function scopeAllows(grant: Scope, requested?: Scope) {
  if (!requested || requested.kind === "organisation") return true;
  if (grant.kind === "organisation") return true;
  return grant.kind === requested.kind && requested.ids.every(id => grant.ids.includes(id));
}
async function humanBase(repository: AuthModRepository, principal: AuthPrincipal, appId?: string) {
  if (principal.type !== "human") return { identity: undefined, grants: [] };
  const identity = await repository.getIdentity(principal.id);
  if (!identity) return { identity: undefined, grants: [] };
  return { identity, grants: await repository.listAuthorityGrants(principal.id, "human") };
}
async function fullAccessScopeAllowed(repository: AuthModRepository, identityId: string, scope: Scope | undefined) {
  if (!scope || scope.kind === "organisation") return true;
  if (scope.kind !== "oploc") return false;
  const active = await repository.listActiveOplocs();
  return scope.ids.every(id => active.some(value => value.id === id && value.active));
}
export async function resolveUserAccess(repository: AuthModRepository, input: { principal: AuthPrincipal; appId?: string; oplocId?: string }): Promise<AuthorizationDecision> {
  try {
    const { identity, grants } = await humanBase(repository, input.principal);
    if (!identity) return deny(input.principal, "unauthenticated");
    if (identity.status !== "active") return deny(input.principal, "identity-inactive");
    if (!input.appId) return { allowed: true, principalId: input.principal.id, principalType: "human", matchedGrantIds: [], reasonCode: "allowed" };
    const app = await repository.getApplication(input.appId);
    if (!app || !app.enabled) return deny(input.principal, "app-disabled", { appId: input.appId });
    const assignment = (await repository.listAppAssignments(identity.id)).find(value => value.appId === input.appId && isEffective(value));
    if (!assignment && !identity.fullAccess) return deny(input.principal, "app-not-assigned", { appId: input.appId });
    if (app.scopeModel !== "none" && input.oplocId) {
      const siteAssignments = await repository.listSiteAssignments(identity.id);
      const siteAllowed = identity.fullAccess
        ? (await repository.listActiveOplocs()).some(value => value.id === input.oplocId && value.active)
        : siteAssignments.some(value => value.oplocId === input.oplocId && isEffective(value));
      if (!siteAllowed) return deny(input.principal, "oploc-not-assigned", { appId: input.appId, scope: { kind: "oploc", ids: [input.oplocId] } });
    }
    const normalGrantIds = grants.filter(value => value.appId === input.appId && value.provenance === "standard-app-access" && isEffective(value)).map(value => value.id);
    return { allowed: true, principalId: identity.id, principalType: "human", appId: input.appId, scope: input.oplocId ? { kind: "oploc", ids: [input.oplocId] } : undefined, matchedGrantIds: normalGrantIds, reasonCode: "allowed" };
  } catch { return deny(input.principal, "store-unavailable"); }
}
export async function evaluateAuthority(repository: AuthModRepository, input: { principal: AuthPrincipal; appId: string; resource: string; action: AuthModAction; scope?: Scope }): Promise<AuthorizationDecision> {
  try {
    const app = await repository.getApplication(input.appId);
    if (!app || !app.enabled) return deny(input.principal, "app-disabled", { appId: input.appId, action: input.action });
    if (input.principal.type === "service") {
      const service = await repository.getServicePrincipal(input.principal.id);
      if (!service || service.status !== "active" || !isEffective(service)) return deny(input.principal, "service-inactive", { appId: input.appId, action: input.action });
      const grants = await repository.listAuthorityGrants(input.principal.id, "service");
      const matched = grants.filter(value => value.appId === input.appId && value.resource === input.resource && value.action === input.action && isEffective(value) && scopeAllows(value.scope, input.scope));
      return matched.length ? { allowed: true, principalId: input.principal.id, principalType: "service", appId: input.appId, action: input.action, scope: input.scope, matchedGrantIds: matched.map(value => value.id), reasonCode: "allowed" } : deny(input.principal, "authority-not-granted", { appId: input.appId, action: input.action, scope: input.scope });
    }
    const base = await resolveUserAccess(repository, { principal: input.principal, appId: input.appId, oplocId: input.scope?.kind === "oploc" ? input.scope.ids[0] : undefined });
    if (!base.allowed) return { ...base, action: input.action };
    const identity = await repository.getIdentity(input.principal.id);
    if (!identity || identity.status !== "active") return deny(input.principal, "identity-inactive", { appId: input.appId, action: input.action });
    const grants = await repository.listAuthorityGrants(identity.id, "human");
    if (identity.fullAccess && app.standardActions.includes(input.action) && await fullAccessScopeAllowed(repository, identity.id, input.scope)) return { ...base, allowed: true, action: input.action, scope: input.scope, matchedGrantIds: [], reasonCode: "allowed" };
    const matched = grants.filter(value => value.appId === input.appId && value.resource === input.resource && value.action === input.action && isEffective(value) && scopeAllows(value.scope, input.scope));
    if (!matched.length) return deny(input.principal, "authority-not-granted", { appId: input.appId, action: input.action, scope: input.scope });
    return { ...base, allowed: true, action: input.action, scope: input.scope, matchedGrantIds: matched.map(value => value.id), reasonCode: "allowed" };
  } catch { return deny(input.principal, "store-unavailable"); }
}
export function assertAllowed(decision: AuthorizationDecision) {
  if (decision.allowed) return decision;
  const status = decision.reasonCode === "store-unavailable" ? 503 : decision.reasonCode === "unauthenticated" ? 401 : 403;
  throw Object.assign(new Error("AUTHMOD authorization denied."), { status, code: "AUTHMOD_DENIED", decision });
}
export async function requireAppAccess(repository: AuthModRepository, input: { principal: AuthPrincipal; appId: string; oplocId?: string }) { return assertAllowed(await resolveUserAccess(repository, input)); }
export async function requireAuthority(repository: AuthModRepository, input: { principal: AuthPrincipal; appId: string; resource: string; action: AuthModAction; scope?: Scope }) { return assertAllowed(await evaluateAuthority(repository, input)); }
export async function requireServiceAuthority(repository: AuthModRepository, input: { principal: Extract<AuthPrincipal, { type: "service" }>; appId: string; resource: string; action: AuthModAction; scope?: Scope }) { return requireAuthority(repository, input); }
export function requireAuthenticatedUser(principal?: AuthPrincipal) {
  if (!principal) throw Object.assign(new Error("An authenticated principal is required."), { status: 401, code: "AUTHMOD_UNAUTHENTICATED" });
  return principal;
}
export function distinctActors(principalIds: string[]) { return new Set(principalIds).size === principalIds.length; }
