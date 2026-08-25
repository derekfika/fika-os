import crypto from "node:crypto";
import type { AuthIdentity, AuthPrincipal } from "./model";
import { normalizeEmail, now } from "./model";
import { appendAudit } from "./audit";
import type { AuthModRepository } from "./repository";

export async function createAuthIdentity(repository: AuthModRepository, input: { actor: AuthPrincipal; displayName: string; email?: string; externalProvider?: string; externalUid?: string; legendId?: string; status?: AuthIdentity["status"]; provenance?: AuthIdentity["provenance"] }) {
  if (input.externalProvider && input.externalUid && await repository.findIdentityByExternal(input.externalProvider, input.externalUid)) throw Object.assign(new Error("External identity is already linked."), { status: 409 });
  if (input.email && await repository.findIdentityByEmail(input.email)) throw Object.assign(new Error("Email is already linked to an AUTHMOD identity."), { status: 409 });
  const timestamp = now(); const identity: AuthIdentity = { id: "authid:" + crypto.randomUUID(), externalProvider: input.externalProvider, externalUid: input.externalUid, normalizedEmail: normalizeEmail(input.email), displayName: input.displayName.trim(), legendId: input.legendId, identityLinkStatus: input.legendId ? "matched" : "unmatched", status: input.status || "active", fullAccess: false, provenance: input.provenance || "manual-override", createdAt: timestamp, updatedAt: timestamp, version: 1 };
  await repository.saveIdentity(identity);
  await appendAudit(repository, { actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "identity-created", afterState: identity, provenance: identity.provenance, outcome: "committed" });
  return identity;
}
export async function linkLegend(repository: AuthModRepository, input: { identityId: string; legendId: string; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  const linked = await repository.findIdentityByLegend(input.legendId);
  if (linked && linked.id !== identity.id) throw Object.assign(new Error("Legend is already linked to another AUTHMOD identity."), { status: 409, code: "AUTHMOD_LEGEND_CONFLICT" });
  const timestamp = now(); const next = { ...identity, legendId: input.legendId, identityLinkStatus: "matched" as const, updatedAt: timestamp, version: identity.version + 1 };
  await repository.saveIdentity(next, identity.version);
  await appendAudit(repository, { actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "legend-linked", beforeState: identity, afterState: next, provenance: "manual-override", outcome: "committed" });
  return next;
}
export async function setIdentityStatus(repository: AuthModRepository, input: { identityId: string; status: AuthIdentity["status"]; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  const next = { ...identity, status: input.status, updatedAt: now(), version: identity.version + 1 };
  await repository.saveIdentity(next, identity.version);
  await appendAudit(repository, { actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "identity-status-changed", beforeState: identity, afterState: next, provenance: "manual-override", outcome: input.status === "active" ? "committed" : "revoked" });
  return next;
}
export async function setFullAccess(repository: AuthModRepository, input: { identityId: string; fullAccess: boolean; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  const next = { ...identity, fullAccess: input.fullAccess, updatedAt: now(), version: identity.version + 1 };
  await repository.saveIdentity(next, identity.version);
  await appendAudit(repository, { actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: input.fullAccess ? "full-access-granted" : "full-access-revoked", beforeState: identity, afterState: next, provenance: "manual-override", outcome: input.fullAccess ? "committed" : "revoked" });
  return next;
}
