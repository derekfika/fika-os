import crypto from "node:crypto";
import type { AuthIdentity, AuthPrincipal, IdentityKind } from "./model";
import { hasAuthmodAdmin } from "./authority";
import { normalizeEmail, now } from "./model";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

export async function createAuthIdentity(repository: AuthModRepository, input: { actor: AuthPrincipal; displayName: string; email?: string; externalProvider?: string; externalUid?: string; identityKind?: IdentityKind; representedOplocId?: string; operationalPurpose?: string; legendId?: string; status?: AuthIdentity["status"]; provenance?: AuthIdentity["provenance"] }) {
  if (input.externalProvider && input.externalUid && await repository.findIdentityByExternal(input.externalProvider, input.externalUid)) throw Object.assign(new Error("External identity is already linked."), { status: 409 });
  if (input.email && await repository.findIdentityByEmail(input.email)) throw Object.assign(new Error("Email is already linked to an AUTHMOD identity."), { status: 409 });
  if (input.legendId && await repository.findIdentityByLegend(input.legendId)) throw Object.assign(new Error("Legend is already linked to an AUTHMOD identity."), { status: 409, code: "AUTHMOD_LEGEND_CONFLICT" });
  if (input.representedOplocId && !(await repository.getActiveOploc(input.representedOplocId))) throw Object.assign(new Error("Represented OPLOC is unknown or inactive."), { status: 422, code: "AUTHMOD_OPLOC_INVALID" });
  const identityKind = input.identityKind || "person";
  if (identityKind === "operational" && input.legendId) throw Object.assign(new Error("Operational identities use custodianship, not personal Legend linkage."), { status: 422, code: "AUTHMOD_OPERATIONAL_LEGEND_LINK" });
  const timestamp = now(); const identity: AuthIdentity = { id: "authid:" + crypto.randomUUID(), externalProvider: input.externalProvider, externalUid: input.externalUid, normalizedEmail: normalizeEmail(input.email), displayName: input.displayName.trim(), identityKind, ...(input.representedOplocId ? { representedOplocId: input.representedOplocId } : {}), ...(input.operationalPurpose ? { operationalPurpose: input.operationalPurpose } : {}), legendId: input.legendId, identityLinkStatus: input.legendId ? "matched" : "unmatched", status: input.status || "active", fullAccess: false, provenance: input.provenance || "manual-override", createdAt: timestamp, updatedAt: timestamp, version: 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "identity-created", afterState: identity, provenance: identity.provenance, outcome: "committed" });
  await repository.saveIdentityWithAudit(identity, audit);
  return identity;
}
export async function linkLegend(repository: AuthModRepository, input: { identityId: string; legendId: string; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  const linked = await repository.findIdentityByLegend(input.legendId);
  if (linked && linked.id !== identity.id) throw Object.assign(new Error("Legend is already linked to another AUTHMOD identity."), { status: 409, code: "AUTHMOD_LEGEND_CONFLICT" });
  const timestamp = now(); const next = { ...identity, legendId: input.legendId, identityLinkStatus: "matched" as const, updatedAt: timestamp, version: identity.version + 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "legend-linked", beforeState: identity, afterState: next, provenance: "manual-override", outcome: "committed" });
  await repository.saveIdentityWithAudit(next, audit, identity.version);
  return next;
}

export async function bindExternalIdentity(repository: AuthModRepository, input: { identityId: string; externalProvider: string; externalUid: string; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 403, code: "AUTHMOD_IDENTITY_NOT_FOUND" });
  const existing = await repository.findIdentityByExternal(input.externalProvider, input.externalUid);
  if (existing && existing.id !== identity.id) throw Object.assign(new Error("Firebase identity is already bound to another AUTHMOD identity."), { status: 403, code: "AUTHMOD_EXTERNAL_IDENTITY_CONFLICT" });
  if (identity.externalProvider && identity.externalUid && (identity.externalProvider !== input.externalProvider || identity.externalUid !== input.externalUid)) throw Object.assign(new Error("AUTHMOD identity is already bound to a different external identity."), { status: 403, code: "AUTHMOD_EXTERNAL_IDENTITY_CONFLICT" });
  if (identity.externalProvider === input.externalProvider && identity.externalUid === input.externalUid) return identity;
  const next = { ...identity, externalProvider: input.externalProvider, externalUid: input.externalUid, updatedAt: now(), version: identity.version + 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "auth-identity-bound", afterState: { externalProvider: input.externalProvider, externalUid: input.externalUid }, provenance: "system", outcome: "committed" });
  await repository.saveIdentityWithAudit(next, audit, identity.version);
  return next;
}
export async function setIdentityStatus(repository: AuthModRepository, input: { identityId: string; status: AuthIdentity["status"]; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  if (identity.identityKind === "person" && identity.status === "active" && input.status !== "active" && await hasAuthmodAdmin(repository, identity.id)) {
    const others = await repository.listIdentities(); const remaining = (await Promise.all(others.filter(value => value.id !== identity.id && value.identityKind === "person" && value.status === "active").map(value => hasAuthmodAdmin(repository, value.id)))).some(Boolean);
    if (!remaining) throw Object.assign(new Error("This is the last active person AUTHMOD Administrator. Assign another administrator before deactivating this one."), { status: 409, code: "AUTHMOD_LAST_ADMIN" });
  }
  const next = { ...identity, status: input.status, updatedAt: now(), version: identity.version + 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "identity-status-changed", beforeState: identity, afterState: next, provenance: "manual-override", outcome: input.status === "active" ? "committed" : "revoked" });
  await repository.saveIdentityWithAudit(next, audit, identity.version);
  return next;
}
export async function setFullAccess(repository: AuthModRepository, input: { identityId: string; fullAccess: boolean; actor: AuthPrincipal; reason: string }) {
  if (!input.reason?.trim() || input.reason.trim().toLowerCase() === "authmod administrator change") throw Object.assign(new Error("A specific reason is required for Full Access changes."), { status: 422, code: "AUTHMOD_REASON_REQUIRED" });
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  if (identity.identityKind === "operational" && input.fullAccess) throw Object.assign(new Error("Full Access is restricted to person identities."), { status: 422, code: "AUTHMOD_PERSON_REQUIRED" });
  const next = { ...identity, fullAccess: input.fullAccess, updatedAt: now(), version: identity.version + 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: input.fullAccess ? "full-access-granted" : "full-access-revoked", beforeState: identity, afterState: next, provenance: "manual-override", outcome: input.fullAccess ? "committed" : "revoked" });
  await repository.saveIdentityWithAudit(next, audit, identity.version);
  return next;
}

export async function setIdentityKind(repository: AuthModRepository, input: { identityId: string; identityKind: IdentityKind; representedOplocId?: string; operationalPurpose?: string; actor: AuthPrincipal; reason: string }) {
  const identity = await repository.getIdentity(input.identityId); if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 });
  if (identity.identityKind === "person" && input.identityKind !== "person" && identity.status === "active" && await hasAuthmodAdmin(repository, identity.id)) {
    const others = await repository.listIdentities(); const remaining = (await Promise.all(others.filter(value => value.id !== identity.id && value.identityKind === "person" && value.status === "active").map(value => hasAuthmodAdmin(repository, value.id)))).some(Boolean);
    if (!remaining) throw Object.assign(new Error("This is the last active person AUTHMOD Administrator. Assign another administrator before changing identity kind."), { status: 409, code: "AUTHMOD_LAST_ADMIN" });
  }
  if (input.representedOplocId && !(await repository.getActiveOploc(input.representedOplocId))) throw Object.assign(new Error("Represented OPLOC is unknown or inactive."), { status: 422, code: "AUTHMOD_OPLOC_INVALID" });
  if (input.identityKind === "operational" && identity.legendId) throw Object.assign(new Error("Operational identities cannot carry personal Legend linkage."), { status: 422, code: "AUTHMOD_OPERATIONAL_LEGEND_LINK" });
  if (input.identityKind === "person" && (input.representedOplocId || input.operationalPurpose)) throw Object.assign(new Error("Person identities cannot carry operational account context."), { status: 422, code: "AUTHMOD_PERSON_CONTEXT_INVALID" });
  const next = { ...identity, identityKind: input.identityKind, representedOplocId: input.representedOplocId, operationalPurpose: input.operationalPurpose, updatedAt: now(), version: identity.version + 1 };
  const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: identity.id, action: "identity-kind-changed", beforeState: identity, afterState: next, provenance: "manual-override", outcome: "committed" });
  await repository.saveIdentityWithAudit(next, audit, identity.version);
  return next;
}
