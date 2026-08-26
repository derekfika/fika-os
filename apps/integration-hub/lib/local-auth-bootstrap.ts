import { auth } from "./firebase-admin";
import { assertLocalSafety } from "./safety";
import { createAuthIdentity, ensureV1ApplicationRegistry, grantAuthmodAdmin, grantStandardApplicationAccess, type AuthModRepository, type AuthPrincipal } from "./authmod-core";
import { auditEvent } from "./authmod-core/audit";

const fixtures = {
  "integration-admin": { email: "admin@local.fika", name: "Integration Administrator", kind: "person" as const },
  reviewer: { email: "reviewer@local.fika", name: "Integration Reviewer", kind: "person" as const },
  viewer: { email: "viewer@local.fika", name: "Integration Viewer", kind: "person" as const },
};
export type LocalFixtureRole = keyof typeof fixtures;

export async function ensureLocalFixtureIdentity(repository: AuthModRepository, role: LocalFixtureRole, uid: string) {
  assertLocalSafety();
  const fixture = fixtures[role];
  let identity = await repository.findIdentityByExternal("firebase", uid) || await repository.findIdentityByEmail(fixture.email);
  if (!identity) {
    const bootstrapActor: AuthPrincipal = { type: "interactive", id: `local-bootstrap:${uid}`, displayName: fixture.name, email: fixture.email, identityKind: fixture.kind };
    identity = await createAuthIdentity(repository, { actor: bootstrapActor, displayName: fixture.name, email: fixture.email, externalProvider: "firebase", externalUid: uid, identityKind: fixture.kind, provenance: "system" });
  } else if (identity.normalizedEmail === fixture.email && (identity.externalProvider === "local" || identity.externalUid !== uid)) {
    const actor: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind };
    const next = { ...identity, externalProvider: "firebase", externalUid: uid, version: identity.version + 1, updatedAt: new Date().toISOString() };
    await repository.saveIdentityWithAudit(next, auditEvent({ actor, targetType: "AuthIdentity", targetId: identity.id, action: "auth-identity-bound", afterState: { externalProvider: "firebase", externalUid: uid }, provenance: "system", outcome: "committed" }), identity.version);
    identity = next;
  }
  const fixtureActor: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind };
  await ensureV1ApplicationRegistry(repository, fixtureActor);
  if (role === "integration-admin") {
    const grants = await repository.listAuthorityGrants(identity.id, "interactive");
    if (!grants.some(value => value.resource === "authmod" && value.action === "Administer" && value.status === "active")) await grantAuthmodAdmin(repository, { identityId: identity.id, actor: fixtureActor, reason: "Explicit local development bootstrap." });
  }
  if (await repository.getApplication("integration-hub")) {
    const access = await repository.listAppAssignments(identity.id);
    if (!access.some(value => value.appId === "integration-hub" && value.status === "active")) await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "integration-hub", actor: fixtureActor, reason: "Explicit local development fixture access." });
  }
  return identity;
}

export async function signInLocalFixture(role: LocalFixtureRole) {
  const { authHost } = assertLocalSafety();
  const fixture = fixtures[role];
  const endpoint = `http://${authHost}/identitytoolkit.googleapis.com/v1`;
  const body = JSON.stringify({ email: fixture.email, password: "Synthetic-Local-Only-2026!", returnSecureToken: true });
  let response = await fetch(`${endpoint}/accounts:signInWithPassword?key=local-only`, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!response.ok) response = await fetch(`${endpoint}/accounts:signUp?key=local-only`, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!response.ok) throw Object.assign(new Error("Local Authentication emulator is unavailable."), { status: 503 });
  return await response.json() as { idToken: string };
}

export function localFixture(role: LocalFixtureRole) { return fixtures[role]; }
