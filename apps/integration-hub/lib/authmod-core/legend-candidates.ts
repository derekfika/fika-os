import type { AuthPrincipal } from "./model";
import { createAuthIdentity, linkLegend } from "./identity";
import { auditEvent } from "./audit";
import type { AuthModRepository } from "./repository";

export async function reconcileLegendCandidate(repository: AuthModRepository, input: { actor: AuthPrincipal; legendId: string; displayName: string; email?: string; active: boolean; externalProvider?: string; externalUid?: string }) {
  const existing = input.externalProvider && input.externalUid ? await repository.findIdentityByExternal(input.externalProvider, input.externalUid) : input.email ? await repository.findIdentityByEmail(input.email) : undefined;
  if (existing) {
    if (!existing.legendId) return linkLegend(repository, { identityId: existing.id, legendId: input.legendId, actor: input.actor, reason: "Reviewed BrightHR Legend reconciliation." });
    if (existing.legendId === input.legendId) return existing;
    const next = { ...existing, identityLinkStatus: "needs-review" as const, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    const audit = auditEvent({ actor: input.actor, targetType: "AuthIdentity", targetId: existing.id, action: "legend-reconciliation-needs-review", beforeState: existing, afterState: next, provenance: "migration", outcome: "rejected" });
    await repository.saveIdentityWithAudit(next, audit, existing.version); return next;
  }
  const linked = await repository.findIdentityByLegend(input.legendId);
  if (linked) return linked.legendId === input.legendId ? linked : undefined;
  return createAuthIdentity(repository, { actor: input.actor, displayName: input.displayName, email: input.email, externalProvider: input.externalProvider, externalUid: input.externalUid, legendId: input.legendId, status: input.active ? "active" : "inactive", provenance: "migration" });
}
