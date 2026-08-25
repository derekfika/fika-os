import { assertLocalSafety } from "./safety";
import { requireActor } from "./auth";
import type { AuthPrincipal } from "./authmod-core";
import { createAuthIdentity, grantAuthmodAdmin, hasAuthmodAdmin, getPrimaryCustodian, FirestoreAuthModRepository } from "./authmod-core";
import type { AuthModRepository } from "./authmod-core";

export function principalFromIdentity(identity: { id: string; displayName: string; normalizedEmail?: string; identityKind: "person" | "operational"; representedOplocId?: string }, custodianLegendId?: string): AuthPrincipal {
  return { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind, representedOplocId: identity.representedOplocId, primaryCustodianLegendId: custodianLegendId };
}

export async function requireAuthmodAdminContext(request: Request) {
  assertLocalSafety();
  const actor = await requireActor(request as unknown as { cookies: { get(name: string): { value?: string } | undefined } }, ["integration-admin"]);
  const repository: AuthModRepository = new FirestoreAuthModRepository();
  let identity = await repository.findIdentityByExternal("local", actor.uid);
  const bootstrapActor: AuthPrincipal = { type: "interactive", id: `local-bootstrap:${actor.uid}`, displayName: actor.name, email: actor.email, identityKind: "person" };
  if (!identity) {
    identity = await createAuthIdentity(repository, { actor: bootstrapActor, displayName: actor.name, email: actor.email, externalProvider: "local", externalUid: actor.uid, identityKind: "person", provenance: "system" });
    await grantAuthmodAdmin(repository, { identityId: identity.id, actor: principalFromIdentity(identity), reason: "Local-only Phase C AUTHMOD bootstrap." });
  }
  const custodian = identity.identityKind === "operational" ? await getPrimaryCustodian(repository, identity.id) : undefined;
  const principal = principalFromIdentity(identity, custodian?.custodianLegendId);
  if (!(await hasAuthmodAdmin(repository, identity.id))) throw Object.assign(new Error("An active person AUTHMOD Administrator account is required."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  return { actor, principal, identity, repository };
}
