import { requireFikaSession } from "./fika-session";
import type { AuthPrincipal } from "./authmod-core";
import { hasAuthmodAdmin, getPrimaryCustodian, FirestoreAuthModRepository } from "./authmod-core";
import type { AuthModRepository } from "./authmod-core";

export function principalFromIdentity(identity: { id: string; displayName: string; normalizedEmail?: string; identityKind: "person" | "operational"; representedOplocId?: string }, custodianLegendId?: string): AuthPrincipal {
  return { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind, representedOplocId: identity.representedOplocId, primaryCustodianLegendId: custodianLegendId };
}

export async function requireAuthmodAdminContext(request: Request) {
  const sessionRepository: AuthModRepository = new FirestoreAuthModRepository("session");
  const session = await requireFikaSession(request as unknown as { cookies: { get(name: string): { value?: string } | undefined } }, sessionRepository);
  const identity = await sessionRepository.getIdentity(session.authmodIdentityId);
  if (!identity) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 403, code: "AUTHMOD_IDENTITY_NOT_FOUND" });
  const principal = principalFromIdentity(identity, session.primaryCustodianLegendId);
  const repository: AuthModRepository = new FirestoreAuthModRepository(`admin:${identity.id}`);
  if (identity.identityKind !== "person" || !(await hasAuthmodAdmin(repository, identity.id))) throw Object.assign(new Error("An active person AUTHMOD Administrator account is required."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  return { actor: { uid: session.firebaseUid, name: session.displayName, email: session.email, role: "integration-admin" as const, synthetic: false as const }, principal, identity, repository };
}
