import crypto from "node:crypto";
import type { AuthPrincipal, CustodianAssignment } from "./model";
import { auditEvent } from "./audit";
import { isEffective, now } from "./model";
import type { AuthModRepository } from "./repository";

export async function assignPrimaryCustodian(repository: AuthModRepository, input: { operationalIdentityId: string; custodianLegendId: string; actor: AuthPrincipal; effectivePeriod?: { effectiveFrom?: string; effectiveTo?: string }; reason: string }) {
  const identity = await repository.getIdentity(input.operationalIdentityId);
  if (!identity || identity.identityKind !== "operational") throw Object.assign(new Error("Primary custodians can only be assigned to operational identities."), { status: 422, code: "AUTHMOD_OPERATIONAL_IDENTITY_REQUIRED" });
  const prior = (await repository.listCustodianAssignments(identity.id)).find(value => isEffective(value));
  const timestamp = now();
  const next: CustodianAssignment = { id: "custody:" + crypto.randomUUID(), operationalIdentityId: identity.id, custodianLegendId: input.custodianLegendId, status: "active", reason: input.reason, assignedBy: input.actor.id, provenance: "manual-override", version: 1, createdAt: timestamp, updatedAt: timestamp, ...input.effectivePeriod };
  const priorRevoked = prior ? { ...prior, status: "revoked" as const, revokedBy: input.actor.id, effectiveTo: timestamp, version: prior.version + 1, updatedAt: timestamp } : undefined;
  const audit = auditEvent({ actor: input.actor, targetType: "CustodianAssignment", targetId: next.id, action: prior ? "custodian-handover" : "custodian-assigned", beforeState: prior, afterState: { prior: priorRevoked, next }, provenance: "manual-override", outcome: "committed" });
  await repository.saveCustodianHandover({ prior: priorRevoked, next, audit, expectedPriorVersion: prior?.version });
  return next;
}

export async function getPrimaryCustodian(repository: AuthModRepository, operationalIdentityId: string) {
  return (await repository.listCustodianAssignments(operationalIdentityId)).find(value => isEffective(value));
}
