import type { AuthPrincipal, AuthorityGrant, EffectivePeriod } from "./model";
import { idempotentId, isEffective, now } from "./model";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

export async function grantAuthority(repository: AuthModRepository, input: { subjectId: string; subjectType: "human" | "service"; actor: AuthPrincipal; appId: string; resource: string; action: AuthorityGrant["action"]; scope: AuthorityGrant["scope"]; provenance?: AuthorityGrant["provenance"]; effectivePeriod?: EffectivePeriod; reason: string }) {
  const id = idempotentId("authority", input.subjectType, input.subjectId, input.appId, input.resource, input.action, input.scope.kind, ...input.scope.ids);
  const existing = (await repository.listAuthorityGrants(input.subjectId, input.subjectType)).find(value => value.id === id); const timestamp = now();
  const grant: AuthorityGrant = { id, subjectType: input.subjectType, subjectId: input.subjectId, appId: input.appId, resource: input.resource, action: input.action, scope: input.scope, status: "active", provenance: input.provenance || "explicit-special-authority", effectiveFrom: input.effectivePeriod?.effectiveFrom, effectiveTo: input.effectivePeriod?.effectiveTo, reason: input.reason, grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthorityGrant", targetId: grant.id, action: "authority-granted", beforeState: existing, afterState: grant, provenance: grant.provenance, outcome: "committed", scope: grant.scope });
  await repository.saveAuthorityGrantWithAudit(grant, audit, existing?.version);
  return grant;
}
export async function grantAuthmodAdmin(repository: AuthModRepository, input: { identityId: string; actor: AuthPrincipal; reason: string }) {
  return grantAuthority(repository, { subjectId: input.identityId, subjectType: "human", actor: input.actor, appId: "integration-hub", resource: "authmod", action: "Administer", scope: { kind: "organisation", ids: [] }, provenance: "explicit-special-authority", reason: input.reason });
}
export async function hasAuthmodAdmin(repository: AuthModRepository, identityId: string) {
  const identity = await repository.getIdentity(identityId); if (!identity || identity.status !== "active") return false;
  return (await repository.listAuthorityGrants(identityId, "human")).some(value => value.appId === "integration-hub" && value.resource === "authmod" && value.action === "Administer" && isEffective(value));
}
