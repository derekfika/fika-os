import type { AuthPrincipal } from "./model";
import { createAuthIdentity } from "./identity";
import type { AuthModRepository } from "./repository";

export async function reconcileLegendCandidate(repository: AuthModRepository, input: { actor: AuthPrincipal; legendId: string; displayName: string; email?: string; active: boolean; externalProvider?: string; externalUid?: string }) {
  const existing = input.externalProvider && input.externalUid ? await repository.findIdentityByExternal(input.externalProvider, input.externalUid) : input.email ? await repository.findIdentityByEmail(input.email) : undefined;
  if (existing) return existing;
  return createAuthIdentity(repository, { actor: input.actor, displayName: input.displayName, email: input.email, externalProvider: input.externalProvider, externalUid: input.externalUid, legendId: input.legendId, status: input.active ? "active" : "inactive", provenance: "migration" });
}
