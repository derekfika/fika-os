import crypto from "node:crypto";
import type { AuthPrincipal, AuthorityGrant, EffectivePeriod, ServicePrincipal } from "./model";
import { idempotentId, now } from "./model";
import { appendAudit } from "./audit";
import type { AuthModRepository } from "./repository";

export async function createServicePrincipal(repository: AuthModRepository, input: { actor: AuthPrincipal; name: string; ownerDomain: string; description?: string; allowedAudiences: string[]; effectivePeriod?: EffectivePeriod }) {
  const timestamp = now(); const principal: ServicePrincipal = { id: "svc:" + crypto.randomUUID(), name: input.name.trim(), ownerDomain: input.ownerDomain.trim(), description: input.description, status: "active", allowedAudiences: [...new Set(input.allowedAudiences)], credentialKeys: [], version: 1, createdAt: timestamp, updatedAt: timestamp, provenance: "manual-override", ...input.effectivePeriod };
  await repository.saveServicePrincipal(principal);
  await appendAudit(repository, { actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-principal-created", afterState: principal, provenance: "manual-override", outcome: "committed" });
  return principal;
}
export async function registerServiceCredential(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; scheme?: "shared-token-transitional" | "managed-key"; expiresAt?: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal) throw Object.assign(new Error("Service principal not found."), { status: 404 });
  const key = { keyId: "key:" + crypto.randomUUID(), scheme: input.scheme || "managed-key", createdAt: now(), expiresAt: input.expiresAt };
  const next = { ...principal, credentialKeys: [...principal.credentialKeys, key], version: principal.version + 1, updatedAt: now() };
  await repository.saveServicePrincipal(next, principal.version);
  await appendAudit(repository, { actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-credential-registered", beforeState: { credentialCount: principal.credentialKeys.length }, afterState: { credentialKeyId: key.keyId, scheme: key.scheme }, provenance: "manual-override", outcome: "committed" });
  return { principal: next, credentialKey: key };
}
export async function revokeServicePrincipal(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; reason: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal) throw Object.assign(new Error("Service principal not found."), { status: 404 });
  const next = { ...principal, status: "revoked" as const, version: principal.version + 1, updatedAt: now() };
  await repository.saveServicePrincipal(next, principal.version);
  await appendAudit(repository, { actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-principal-revoked", beforeState: principal, afterState: next, provenance: "manual-override", outcome: "revoked" });
  return next;
}
export async function grantServiceAuthority(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; appId: string; resource: string; action: AuthorityGrant["action"]; scope: AuthorityGrant["scope"]; effectivePeriod?: EffectivePeriod; reason: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal || principal.status !== "active") throw Object.assign(new Error("Service principal is not active."), { status: 422 });
  const id = idempotentId("service-grant", input.principalId, input.appId, input.resource, input.action, input.scope.kind, ...input.scope.ids);
  const existing = (await repository.listAuthorityGrants(input.principalId, "service")).find(value => value.id === id); const timestamp = now();
  const grant: AuthorityGrant = { id, subjectType: "service", subjectId: input.principalId, appId: input.appId, resource: input.resource, action: input.action, scope: input.scope, status: "active", provenance: "explicit-special-authority", reason: input.reason, grantedBy: input.actor.id, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp, ...input.effectivePeriod };
  await repository.saveAuthorityGrant(grant, existing?.version);
  await appendAudit(repository, { actor: input.actor, targetType: "AuthorityGrant", targetId: id, action: "service-authority-granted", afterState: grant, provenance: "explicit-special-authority", outcome: "committed", scope: input.scope });
  return grant;
}
export function transitionalCredentialMatches(input: { presentedToken?: string; expectedToken?: string; principal: ServicePrincipal; keyId?: string }) {
  if (!input.presentedToken || !input.expectedToken || input.presentedToken !== input.expectedToken || input.principal.status !== "active") return false;
  const key = input.principal.credentialKeys.find(value => value.keyId === input.keyId && !value.revokedAt && (!value.expiresAt || Date.parse(value.expiresAt) > Date.now()));
  return Boolean(key && key.scheme === "shared-token-transitional");
}
