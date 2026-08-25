import type { AuthPrincipal, AuthorityGrant, EffectivePeriod } from "./model";
import { idempotentId, isEffective, now } from "./model";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

export const PERSON_REQUIRED_AUTHORITIES = ["authmod", "authmod.admin", "menu.publish", "production.allergen-sign", "production.allergen-final-approve"] as const;
export function isPersonRequiredAuthority(resource: string) { return (PERSON_REQUIRED_AUTHORITIES as readonly string[]).includes(resource); }

export async function grantAuthority(repository: AuthModRepository, input: { subjectId: string; subjectType: "interactive" | "service"; actor: AuthPrincipal; appId: string; resource: string; action: AuthorityGrant["action"]; scope: AuthorityGrant["scope"]; provenance?: AuthorityGrant["provenance"]; effectivePeriod?: EffectivePeriod; reason: string }) {
  if (isPersonRequiredAuthority(input.resource)) {
    if (input.subjectType !== "interactive") throw Object.assign(new Error("This authority requires a person identity."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" });
    const target = await repository.getIdentity(input.subjectId);
    if (!target || target.identityKind !== "person") throw Object.assign(new Error("This authority requires a person identity."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" });
  }
  const id = idempotentId("authority", input.subjectType, input.subjectId, input.appId, input.resource, input.action, input.scope.kind, ...input.scope.ids);
  const existing = (await repository.listAuthorityGrants(input.subjectId, input.subjectType)).find(value => value.id === id); const timestamp = now();
  const grant: AuthorityGrant = { id, subjectType: input.subjectType, subjectId: input.subjectId, appId: input.appId, resource: input.resource, action: input.action, scope: input.scope, status: "active", provenance: input.provenance || "explicit-special-authority", effectiveFrom: input.effectivePeriod?.effectiveFrom, effectiveTo: input.effectivePeriod?.effectiveTo, reason: input.reason, grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthorityGrant", targetId: grant.id, action: "authority-granted", beforeState: existing, afterState: grant, provenance: grant.provenance, outcome: "committed", scope: grant.scope });
  await repository.saveAuthorityGrantWithAudit(grant, audit, existing?.version);
  return grant;
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
