import type { AuthModRepository, OplocReference } from "./repository";
import { isEffective } from "./model";
import type { AuthPrincipal, AuthorizationDecision, AuthModAction, Scope } from "./model";
import { isPersonRequiredAuthority } from "./authority";

export class AuthModEvaluationContext {
  private identityPromise?: Promise<Awaited<ReturnType<AuthModRepository["getIdentity"]>>>;
  private grantsPromise?: Promise<Awaited<ReturnType<AuthModRepository["listAuthorityGrants"]>>>;
  private appAssignmentsPromise?: Promise<Awaited<ReturnType<AuthModRepository["listAppAssignments"]>>>;
  private siteAssignmentsPromise?: Promise<Awaited<ReturnType<AuthModRepository["listSiteAssignments"]>>>;
  private applicationPromises = new Map<string, Promise<Awaited<ReturnType<AuthModRepository["getApplication"]>>>>();
  private oplocPromises = new Map<string, Promise<Awaited<ReturnType<AuthModRepository["getActiveOploc"]>>>>();
  private delegationsPromise?: Promise<Awaited<ReturnType<AuthModRepository["listDelegations"]>>>;
  private activeOplocsPromise?: Promise<Awaited<ReturnType<AuthModRepository["listActiveOplocs"]>>>;
  private readonly seededOplocs: Map<string, OplocReference>;
  constructor(readonly repository: AuthModRepository, readonly principal: AuthPrincipal, activeOplocs: OplocReference[] = []) { this.seededOplocs = new Map(activeOplocs.map(oploc => [oploc.id, oploc])); }
  identity() { return this.identityPromise ||= this.principal.type === "interactive" ? this.repository.getIdentity(this.principal.id) : Promise.resolve(undefined); }
  grants() { return this.grantsPromise ||= this.principal.type === "interactive" ? this.repository.listAuthorityGrants(this.principal.id, "interactive") : Promise.resolve([]); }
  appAssignments() { return this.appAssignmentsPromise ||= this.identity().then(identity => identity ? this.repository.listAppAssignments(identity.id) : []); }
  siteAssignments() { return this.siteAssignmentsPromise ||= this.identity().then(identity => identity ? this.repository.listSiteAssignments(identity.id) : []); }
  application(appId: string) { let result = this.applicationPromises.get(appId); if (!result) { result = this.repository.getApplication(appId); this.applicationPromises.set(appId, result); } return result; }
  activeOploc(oplocId: string) { const seeded = this.seededOplocs.get(oplocId); if (seeded) return Promise.resolve(seeded); let result = this.oplocPromises.get(oplocId); if (!result) { result = this.repository.getActiveOploc(oplocId); this.oplocPromises.set(oplocId, result); } return result; }
  activeOplocs() { return this.activeOplocsPromise ||= this.repository.listActiveOplocs(); }
  delegations() { return this.delegationsPromise ||= this.principal.type === "interactive" ? this.repository.listDelegations(this.principal.id) : Promise.resolve([]); }
}

export const LOGISTICS_VEHICLE_IDS = ["van1", "van2"] as const;
export type LogisticsVehicleId = (typeof LOGISTICS_VEHICLE_IDS)[number];

export async function resolvePermittedVehicleIds(repository: AuthModRepository, input: { principal: AuthPrincipal; vehicleIds?: readonly string[] }, context = createAuthModEvaluationContext(repository, input.principal)) {
  const vehicleIds = input.vehicleIds || LOGISTICS_VEHICLE_IDS;
  const decisions = await Promise.all(vehicleIds.map(vehicleId => evaluateAuthority(repository, { principal: input.principal, appId: "logistics", resource: "logistics.vehicle", action: "View", scope: { kind: "resource", ids: [vehicleId] } }, context)));
  return { permittedVehicleIds: decisions.filter(decision => decision.allowed).map((_, index) => vehicleIds[index]), resolutionFailed: decisions.some(decision => decision.reasonCode === "store-unavailable") };
}

export function createAuthModEvaluationContext(repository: AuthModRepository, principal: AuthPrincipal, activeOplocs?: OplocReference[]) { return new AuthModEvaluationContext(repository, principal, activeOplocs); }

function earliestExpiry(...values: Array<{ effectiveTo?: string } | undefined>) {
  const expiries = values.map(value => value?.effectiveTo).filter((value): value is string => Boolean(value));
  return expiries.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function deny(principal: AuthPrincipal, reasonCode: AuthorizationDecision["reasonCode"], extra: Partial<AuthorizationDecision> = {}): AuthorizationDecision {
  return { allowed: false, principalId: principal.id, principalType: principal.type, matchedGrantIds: [], reasonCode, ...extra };
}
function scopeAllows(grant: Scope, requested?: Scope) {
  if (!requested) return grant.kind === "organisation";
  if (requested.kind === "organisation") return grant.kind === "organisation";
  if (requested.kind === "oploc") return grant.kind === "organisation" || (grant.kind === "oploc" && requested.ids.every(id => grant.ids.includes(id)));
  return grant.kind === "resource" && requested.ids.every(id => grant.ids.includes(id));
}
async function fullAccessScopeAllowed(context: AuthModEvaluationContext, scope: Scope | undefined) {
  if (!scope || scope.kind === "organisation") return true;
  if (scope.kind !== "oploc") return false;
  return (await Promise.all(scope.ids.map(id => context.activeOploc(id)))).every(Boolean);
}
export async function resolveUserAccess(repository: AuthModRepository, input: { principal: AuthPrincipal; appId?: string; oplocId?: string; oplocIds?: string[] }, context = createAuthModEvaluationContext(repository, input.principal)): Promise<AuthorizationDecision> {
  try {
    const identity = await context.identity();
    const grants = await context.grants();
    if (!identity) return deny(input.principal, "unauthenticated");
    if (identity.status !== "active") return deny(input.principal, "identity-inactive");
    if (!input.appId) return { allowed: true, principalId: input.principal.id, principalType: "interactive", matchedGrantIds: [], reasonCode: "allowed" };
    const app = await context.application(input.appId);
    if (!app || !app.enabled) return deny(input.principal, "app-disabled", { appId: input.appId });
    const hasFullAccess = identity.identityKind === "person" && identity.fullAccess;
    const assignment = (await context.appAssignments()).find(value => value.appId === input.appId && isEffective(value));
    if (!assignment && !hasFullAccess) return deny(input.principal, "app-not-assigned", { appId: input.appId });
    const requestedOplocIds = input.oplocIds || (input.oplocId ? [input.oplocId] : []);
    if (app.scopeModel !== "none" && requestedOplocIds.length) {
      const siteAssignments = await context.siteAssignments();
      const activeOplocs = await Promise.all(requestedOplocIds.map(oplocId => context.activeOploc(oplocId)));
      const siteAllowed = requestedOplocIds.every((oplocId, index) => Boolean(activeOplocs[index]) && (hasFullAccess || siteAssignments.some(value => value.oplocId === oplocId && isEffective(value))));
      if (!siteAllowed) return deny(input.principal, "oploc-not-assigned", { appId: input.appId, scope: { kind: "oploc", ids: requestedOplocIds } });
    }
    const normalGrantIds = grants.filter(value => value.appId === input.appId && value.provenance === "standard-app-access" && isEffective(value)).map(value => value.id);
    const selectedSiteAssignments = requestedOplocIds.length ? await context.siteAssignments() : [];
    const validUntil = earliestExpiry(identity, assignment, ...requestedOplocIds.map(id => selectedSiteAssignments.find(value => value.oplocId === id && isEffective(value))));
    return { allowed: true, principalId: identity.id, principalType: "interactive", appId: input.appId, scope: input.oplocId ? { kind: "oploc", ids: [input.oplocId] } : undefined, matchedGrantIds: normalGrantIds, reasonCode: "allowed", ...(validUntil ? { validUntil } : {}) };
  } catch { return deny(input.principal, "store-unavailable"); }
}
export async function evaluateAuthority(repository: AuthModRepository, input: { principal: AuthPrincipal; appId: string; resource: string; action: AuthModAction; scope?: Scope }, context = createAuthModEvaluationContext(repository, input.principal)): Promise<AuthorizationDecision> {
  try {
    const app = await context.application(input.appId);
    if (!app || !app.enabled) return deny(input.principal, "app-disabled", { appId: input.appId, action: input.action });
    const operationalApp = app.scopeModel !== "none";
    if (operationalApp && !input.scope) return deny(input.principal, "invalid-request", { appId: input.appId, action: input.action });
    if (input.principal.type === "service") {
      const service = await repository.getServicePrincipal(input.principal.id);
      if (!service || service.status !== "active" || !isEffective(service)) return deny(input.principal, "service-inactive", { appId: input.appId, action: input.action });
      const grants = await repository.listAuthorityGrants(input.principal.id, "service");
      const matched = grants.filter(value => value.appId === input.appId && value.resource === input.resource && value.action === input.action && isEffective(value) && scopeAllows(value.scope, input.scope));
      return matched.length ? { allowed: true, principalId: input.principal.id, principalType: "service", appId: input.appId, action: input.action, scope: input.scope, matchedGrantIds: matched.map(value => value.id), reasonCode: "allowed" } : deny(input.principal, "authority-not-granted", { appId: input.appId, action: input.action, scope: input.scope });
    }
    const base = await resolveUserAccess(repository, { principal: input.principal, appId: input.appId, oplocIds: input.scope?.kind === "oploc" ? input.scope.ids : undefined }, context);
    if (!base.allowed) return { ...base, action: input.action };
    const identity = await context.identity();
    if (!identity || identity.status !== "active") return deny(input.principal, "identity-inactive", { appId: input.appId, action: input.action });
    const grants = await context.grants(); const delegations = await context.delegations(); const delegatedSourceIds = new Set((await Promise.all(delegations.filter(value => isEffective(value)).map(async value => (await repository.listAuthorityGrants(value.delegatorId, "interactive")).some(grant => grant.id === value.sourceAuthorityGrantId && isEffective(grant)) ? value.delegatedAuthorityGrantId : undefined))).filter(Boolean));
    if (isPersonRequiredAuthority(input.resource) && identity.identityKind !== "person") return deny(input.principal, "authority-not-granted", { appId: input.appId, action: input.action, scope: input.scope });
    if (identity.identityKind === "person" && identity.fullAccess && app.standardResource === input.resource && app.standardActions.includes(input.action) && await fullAccessScopeAllowed(context, input.scope)) return { ...base, allowed: true, action: input.action, scope: input.scope, matchedGrantIds: [], reasonCode: "allowed" };
    const requestedScope = input.scope;
    const matched = grants.filter(value => value.appId === input.appId && value.resource === input.resource && value.action === input.action && isEffective(value) && (!value.delegationSourceGrantId || delegatedSourceIds.has(value.id)) && scopeAllows(value.scope, requestedScope));
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
