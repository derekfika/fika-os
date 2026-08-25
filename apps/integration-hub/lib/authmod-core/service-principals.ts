import crypto from "node:crypto";
import type { AuthPrincipal, AuthorityGrant, EffectivePeriod, ServicePrincipal } from "./model";
import { idempotentId, isEffective, now } from "./model";
import { auditEvent } from "./audit";
import { grantAuthority } from "./authority";
import type { AuthModRepository } from "./repository";

export async function createServicePrincipal(repository: AuthModRepository, input: { actor: AuthPrincipal; name: string; ownerDomain: string; description?: string; allowedAudiences: string[]; effectivePeriod?: EffectivePeriod }) {
  const timestamp = now(); const principal: ServicePrincipal = { id: "svc:" + crypto.randomUUID(), name: input.name.trim(), ownerDomain: input.ownerDomain.trim(), description: input.description, status: "active", allowedAudiences: [...new Set(input.allowedAudiences)], credentialKeys: [], version: 1, createdAt: timestamp, updatedAt: timestamp, provenance: "manual-override", ...input.effectivePeriod };
  const audit = auditEvent({ actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-principal-created", afterState: principal, provenance: "manual-override", outcome: "committed" });
  await repository.saveServicePrincipalWithAudit(principal, audit);
  return principal;
}
export async function registerServiceCredential(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; scheme?: "shared-token-transitional" | "managed-key"; expiresAt?: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal) throw Object.assign(new Error("Service principal not found."), { status: 404 });
  const key = { keyId: "key:" + crypto.randomUUID(), scheme: input.scheme || "managed-key", createdAt: now(), expiresAt: input.expiresAt };
  const next = { ...principal, credentialKeys: [...principal.credentialKeys, key], version: principal.version + 1, updatedAt: now() };
  const audit = auditEvent({ actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-credential-registered", beforeState: { credentialCount: principal.credentialKeys.length }, afterState: { credentialKeyId: key.keyId, scheme: key.scheme }, provenance: "manual-override", outcome: "committed" });
  await repository.saveServicePrincipalWithAudit(next, audit, principal.version);
  return { principal: next, credentialKey: key };
}
export async function revokeServicePrincipal(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; reason: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal) throw Object.assign(new Error("Service principal not found."), { status: 404 });
  const next = { ...principal, status: "revoked" as const, version: principal.version + 1, updatedAt: now() };
  const audit = auditEvent({ actor: input.actor, targetType: "ServicePrincipal", targetId: principal.id, action: "service-principal-revoked", beforeState: principal, afterState: next, provenance: "manual-override", outcome: "revoked" });
  await repository.saveServicePrincipalWithAudit(next, audit, principal.version);
  return next;
}
export async function grantServiceAuthority(repository: AuthModRepository, input: { principalId: string; actor: AuthPrincipal; appId: string; resource: string; action: AuthorityGrant["action"]; scope: AuthorityGrant["scope"]; effectivePeriod?: EffectivePeriod; reason: string }) {
  const principal = await repository.getServicePrincipal(input.principalId); if (!principal || principal.status !== "active") throw Object.assign(new Error("Service principal is not active."), { status: 422 });
  return grantAuthority(repository, { subjectId: input.principalId, subjectType: "service", actor: input.actor, appId: input.appId, resource: input.resource, action: input.action, scope: input.scope, provenance: "explicit-special-authority", effectivePeriod: input.effectivePeriod, reason: input.reason });
}
export function transitionalCredentialMatches(input: { presentedToken?: string; expectedToken?: string; principal: ServicePrincipal; keyId?: string; audience?: string }) {
  if (!input.presentedToken || !input.expectedToken || input.principal.status !== "active" || !isEffective(input.principal)) return false;
  if (input.audience && !input.principal.allowedAudiences.includes(input.audience)) return false;
  const presented = Buffer.from(input.presentedToken); const expected = Buffer.from(input.expectedToken);
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) return false;
  const key = input.principal.credentialKeys.find(value => value.keyId === input.keyId && !value.revokedAt && (!value.expiresAt || Date.parse(value.expiresAt) > Date.now()));
  return Boolean(key && key.scheme === "shared-token-transitional");
}
