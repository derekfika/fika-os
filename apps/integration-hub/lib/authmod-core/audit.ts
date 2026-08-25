import crypto from "node:crypto";
import type { AccessAuditEvent, AuthPrincipal, Provenance, Scope } from "./model";
import type { AuthModRepository } from "./repository";

export function auditEvent(input: {
  actor: AuthPrincipal; targetType: string; targetId: string; action: string; scope?: Scope;
  beforeState?: unknown; afterState?: unknown; provenance: Provenance; outcome: AccessAuditEvent["outcome"];
  correlationId?: string; idempotencyKey?: string;
}): AccessAuditEvent {
  return {
    id: crypto.randomUUID(), timestamp: new Date().toISOString(), actorPrincipalId: input.actor.id,
    actorPrincipalType: input.actor.type, actorSnapshot: { displayName: input.actor.displayName, ...(input.actor.type === "interactive" && input.actor.email ? { email: input.actor.email } : {}), ...(input.actor.type === "interactive" && input.actor.identityKind ? { identityKind: input.actor.identityKind } : {}), ...(input.actor.type === "interactive" && input.actor.representedOplocId ? { representedOplocId: input.actor.representedOplocId } : {}), ...(input.actor.type === "interactive" && input.actor.primaryCustodianLegendId ? { primaryCustodianLegendId: input.actor.primaryCustodianLegendId } : {}) },
    targetType: input.targetType, targetId: input.targetId, action: input.action, beforeState: input.beforeState,
    afterState: input.afterState, scope: input.scope || { kind: "organisation", ids: [] }, provenance: input.provenance,
    correlationId: input.correlationId, idempotencyKey: input.idempotencyKey, outcome: input.outcome,
  };
}
export async function appendAudit(repository: AuthModRepository, input: Parameters<typeof auditEvent>[0]) {
  const event = auditEvent(input); await repository.appendAudit(event); return event;
}
