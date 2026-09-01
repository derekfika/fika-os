import type { AuthPrincipal, AuthorityGrant, AuthModAction, DelegationRecord, EffectivePeriod } from "./model";
import { assertValidEffectivePeriod, idempotentId, isEffective, now } from "./model";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

export const PERSON_REQUIRED_AUTHORITIES = ["authmod", "authmod.admin", "menu.publish"] as const;
export function isPersonRequiredAuthority(resource: string) { return (PERSON_REQUIRED_AUTHORITIES as readonly string[]).includes(resource); }
export const ORGANISATION_AUTHORITIES = ["authmod", "menu.publish"] as const;
export function isOrganisationAuthority(resource: string) { return (ORGANISATION_AUTHORITIES as readonly string[]).includes(resource); }
export const OPLOC_SCOPED_AUTHORITIES = ["production.allergen-sign", "production.allergen-final-approve"] as const;
export function isOplocScopedAuthority(resource: string) { return (OPLOC_SCOPED_AUTHORITIES as readonly string[]).includes(resource); }

export async function grantAuthority(repository: AuthModRepository, input: { subjectId: string; subjectType: "interactive" | "service"; actor: AuthPrincipal; appId: string; resource: string; action: AuthorityGrant["action"]; scope: AuthorityGrant["scope"]; provenance?: AuthorityGrant["provenance"]; effectivePeriod?: EffectivePeriod; reason: string }) {
  if (!input.reason?.trim() || input.reason.trim().toLowerCase() === "authmod administrator change") throw Object.assign(new Error("A specific reason is required for authority changes."), { status: 422, code: "AUTHMOD_REASON_REQUIRED" });
  const effectivePeriod = input.effectivePeriod?.effectiveTo && !input.effectivePeriod.effectiveFrom ? { ...input.effectivePeriod, effectiveFrom: "1970-01-01T00:00:00.000Z" } : input.effectivePeriod; assertValidEffectivePeriod(effectivePeriod, false);
  if (isPersonRequiredAuthority(input.resource)) {
    if (input.subjectType !== "interactive") throw Object.assign(new Error("This authority requires a person identity."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" });
    const target = await repository.getIdentity(input.subjectId);
    if (!target || target.identityKind !== "person") throw Object.assign(new Error("This authority requires a person identity."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" });
  }
  if (isOrganisationAuthority(input.resource) && input.scope.kind !== "organisation") throw Object.assign(new Error("This authority is organisation-wide and cannot be OPLOC-scoped."), { status: 422, code: "AUTHMOD_ORGANISATION_SCOPE_REQUIRED" });
  if (isOplocScopedAuthority(input.resource) && (input.scope.kind !== "oploc" || !input.scope.ids.length)) throw Object.assign(new Error("This authority requires an explicit OPLOC scope."), { status: 422, code: "AUTHMOD_OPLOC_SCOPE_REQUIRED" });
  const id = idempotentId("authority", input.subjectType, input.subjectId, input.appId, input.resource, input.action, input.scope.kind, ...input.scope.ids);
  const existing = (await repository.listAuthorityGrants(input.subjectId, input.subjectType)).find(value => value.id === id); const timestamp = now();
  const grant: AuthorityGrant = { id, subjectType: input.subjectType, subjectId: input.subjectId, appId: input.appId, resource: input.resource, action: input.action, scope: input.scope, status: "active", provenance: input.provenance || "explicit-special-authority", effectiveFrom: effectivePeriod?.effectiveFrom, effectiveTo: effectivePeriod?.effectiveTo, reason: input.reason, grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthorityGrant", targetId: grant.id, action: "authority-granted", beforeState: existing, afterState: grant, provenance: grant.provenance, outcome: "committed", scope: grant.scope });
  await repository.saveAuthorityGrantWithAudit(grant, audit, existing?.version);
  return grant;
}
const ACTION_RANK: Record<AuthModAction, number> = { View: 1, Contribute: 2, Manage: 3, Approve: 4, Publish: 5, Administer: 6 };
function scopeWithin(source: AuthorityGrant["scope"], requested: AuthorityGrant["scope"]) { if (source.kind === "organisation") return requested.kind === "organisation" || requested.kind === "oploc" || requested.kind === "resource"; return source.kind === requested.kind && requested.ids.every(id => source.ids.includes(id)); }
export async function createDelegation(repository: AuthModRepository, input: { delegatorId: string; delegateId: string; sourceGrantId: string; action: AuthModAction; scope: AuthorityGrant["scope"]; effectiveFrom: string; effectiveTo: string; actor: AuthPrincipal; reason: string }) {
  assertValidEffectivePeriod({ effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }, true); if (!input.reason?.trim()) throw Object.assign(new Error("A reason is required for delegation."), { status: 422, code: "AUTHMOD_REASON_REQUIRED" });
  const source = (await repository.listAuthorityGrants(input.delegatorId, "interactive")).find(value => value.id === input.sourceGrantId); if (!source || !isEffective(source)) throw Object.assign(new Error("Delegation source authority is not currently effective."), { status: 422, code: "AUTHMOD_DELEGATION_SOURCE_INVALID" });
  if (source.delegationSourceGrantId) throw Object.assign(new Error("Recursive delegation is not supported."), { status: 422, code: "AUTHMOD_DELEGATION_RECURSIVE" });
  if (isOrganisationAuthority(source.resource) && input.scope.kind !== "organisation") throw Object.assign(new Error("This authority is organisation-wide and cannot be OPLOC-scoped."), { status: 422, code: "AUTHMOD_ORGANISATION_SCOPE_REQUIRED" });
  if (isOplocScopedAuthority(source.resource) && (input.scope.kind !== "oploc" || !input.scope.ids.length)) throw Object.assign(new Error("This authority requires an explicit OPLOC scope."), { status: 422, code: "AUTHMOD_OPLOC_SCOPE_REQUIRED" });
  if (ACTION_RANK[input.action] > ACTION_RANK[source.action] || !scopeWithin(source.scope, input.scope)) throw Object.assign(new Error("Delegated authority cannot exceed the source authority."), { status: 422, code: "AUTHMOD_DELEGATION_EXCEEDS_SOURCE" });
  if (source.effectiveTo && Date.parse(input.effectiveTo) > Date.parse(source.effectiveTo)) throw Object.assign(new Error("Delegation cannot outlive its source authority."), { status: 422, code: "AUTHMOD_DELEGATION_OUTLIVES_SOURCE" });
  if (isPersonRequiredAuthority(source.resource)) { const target = await repository.getIdentity(input.delegateId); if (!target || target.identityKind !== "person") throw Object.assign(new Error("Delegated authority requires a person identity."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" }); }
  const id = idempotentId("delegation", source.id, input.delegateId, input.action, input.scope.kind, ...input.scope.ids); const timestamp = now(); const grant: AuthorityGrant = { id: idempotentId("authority", "interactive", input.delegateId, source.appId || "", source.resource, input.action, input.scope.kind, ...input.scope.ids), subjectType: "interactive", subjectId: input.delegateId, appId: source.appId, resource: source.resource, action: input.action, scope: input.scope, status: "active", provenance: "explicit-special-authority", accessType: "delegated", delegationSourceGrantId: source.id, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, reason: input.reason, grantedBy: input.actor.id, version: 1, createdAt: timestamp, updatedAt: timestamp };
  const delegation: DelegationRecord = { id, delegatorId: input.delegatorId, delegateId: input.delegateId, sourceAuthorityGrantId: source.id, delegatedAuthorityGrantId: grant.id, appId: source.appId || "", resource: source.resource, action: input.action, scope: input.scope, status: "active", effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, reason: input.reason, createdBy: input.actor.id, createdAt: timestamp, updatedAt: timestamp, version: 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "DelegationRecord", targetId: delegation.id, action: "delegation-created", afterState: { delegation, grant }, provenance: "explicit-special-authority", outcome: "committed", scope: input.scope }); await repository.saveDelegationWithGrant({ delegation, grant, audit }); return { delegation, grant };
}
export async function grantAuthmodAdmin(repository: AuthModRepository, input: { identityId: string; actor: AuthPrincipal; reason: string }) {
  return grantAuthority(repository, { subjectId: input.identityId, subjectType: "interactive", actor: input.actor, appId: "integration-hub", resource: "authmod", action: "Administer", scope: { kind: "organisation", ids: [] }, provenance: "explicit-special-authority", reason: input.reason });
}
export async function hasAuthmodAdmin(repository: AuthModRepository, identityId: string) {
  const identity = await repository.getIdentity(identityId); if (!identity || identity.identityKind !== "person" || identity.status !== "active") return false;
  return (await repository.listAuthorityGrants(identityId, "interactive")).some(value => value.appId === "integration-hub" && value.resource === "authmod" && value.action === "Administer" && isEffective(value));
}

export async function revokeAuthority(repository: AuthModRepository, input: { grantId: string; actor: AuthPrincipal; reason: string; expectedVersion?: number }) {
  const grants = await repository.listAuthorityGrants(input.actor.id, "interactive");
  let grant = grants.find(value => value.id === input.grantId);
  if (!grant) {
    const identities = await repository.listIdentities();
    for (const identity of identities) { grant = (await repository.listAuthorityGrants(identity.id, "interactive")).find(value => value.id === input.grantId); if (grant) break; }
  }
  if (!grant) throw Object.assign(new Error("AUTHMOD authority grant not found."), { status: 404 });
  if (input.expectedVersion !== undefined && grant.version !== input.expectedVersion) throw Object.assign(new Error("AUTHMOD authority changed since it was opened."), { status: 409, code: "AUTHMOD_VERSION_CONFLICT" });
  if (grant.resource === "authmod" && grant.action === "Administer") {
    const identities = await repository.listIdentities();
    const remaining = (await Promise.all(identities.filter(value => value.id !== grant.subjectId && value.identityKind === "person" && value.status === "active").map(value => hasAuthmodAdmin(repository, value.id)))).filter(Boolean).length;
    if (!remaining) throw Object.assign(new Error("This is the last active person AUTHMOD Administrator. Assign another administrator before removing this one."), { status: 409, code: "AUTHMOD_LAST_ADMIN" });
  }
  const next = { ...grant, status: "revoked" as const, revokedBy: input.actor.id, reason: input.reason, version: grant.version + 1, updatedAt: now() };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthorityGrant", targetId: grant.id, action: "authority-revoked", beforeState: grant, afterState: next, provenance: grant.provenance, outcome: "revoked", scope: grant.scope });
  await repository.saveAuthorityGrantWithAudit(next, audit, grant.version);
  return next;
}
