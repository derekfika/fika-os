import type { DecodedIdToken } from "firebase-admin/auth";
import { auth } from "./firebase-admin";
import { sessionCookieConfig, allowedEmailDomains } from "./runtime-config";
import { bindExternalIdentity } from "./authmod-core/identity";
import { FirestoreAuthModRepository } from "./authmod-core";
import { getPrimaryCustodian, type AuthIdentity, type AuthModRepository, type AuthPrincipal } from "./authmod-core";
import { logAuthDiagnostic } from "../../../shared/auth-diagnostics";

export type FikaSessionPrincipal = {
  firebaseUid: string;
  authmodIdentityId: string;
  displayName: string;
  email?: string;
  identityKind: "person" | "operational";
  representedOplocId?: string;
  primaryCustodianLegendId?: string;
};

export class FikaSessionError extends Error { constructor(message: string, public status: 401 | 403 = 401, public code = "FIKA_SESSION_INVALID") { super(message); } }
type SessionAuth = { verifySessionCookie(cookie: string, checkRevoked?: boolean): Promise<DecodedIdToken>; createSessionCookie(idToken: string, options: { expiresIn: number }): Promise<string> };

function isAllowedEmail(email: unknown, domains = allowedEmailDomains()) {
  const normalized = String(email || "").trim().toLowerCase();
  return Boolean(normalized && domains.some(domain => normalized.endsWith(`@${domain}`)));
}

export function assertRecentVerifiedFirebaseIdentity(decoded: Pick<DecodedIdToken, "email" | "email_verified" | "auth_time">, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!decoded.email || decoded.email_verified !== true || !isAllowedEmail(decoded.email)) throw new FikaSessionError("This Google Workspace identity is not eligible for FIKA OS.", 403, "FIKA_EMAIL_NOT_ELIGIBLE");
  if (!decoded.auth_time || nowSeconds - decoded.auth_time > 5 * 60) throw new FikaSessionError("Sign-in is too old. Authenticate again to create a FIKA OS session.", 401, "FIKA_RECENT_AUTH_REQUIRED");
}

export async function resolveSessionIdentity(repository: AuthModRepository, decoded: Pick<DecodedIdToken, "uid" | "email" | "name">, actor?: AuthPrincipal) {
  const externalMatches = await repository.findIdentitiesByExternal("firebase", decoded.uid, 2);
  if (externalMatches.length > 1) throw new FikaSessionError("This external identity needs administrator review.", 403, "AUTHMOD_EXTERNAL_IDENTITY_CONFLICT");
  let identity = externalMatches[0];
  if (!identity && decoded.email) {
    const emailMatches = await repository.findIdentitiesByEmail(decoded.email, 2);
    if (emailMatches.length > 1) throw new FikaSessionError("This FIKA OS account needs administrator review before sign-in.", 403, "AUTHMOD_EMAIL_IDENTITY_CONFLICT");
    identity = emailMatches[0];
    if (identity) {
      const bindingActor = actor || { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind };
      identity = await bindExternalIdentity(repository, { identityId: identity.id, externalProvider: "firebase", externalUid: decoded.uid, actor: bindingActor, reason: "Firebase Workspace session identity binding." });
    }
  }
  if (!identity) throw new FikaSessionError("This authenticated identity has not been enrolled in AUTHMOD.", 403, "AUTHMOD_IDENTITY_NOT_FOUND");
  if (identity.externalProvider !== "firebase" || identity.externalUid !== decoded.uid) throw new FikaSessionError("This external identity conflicts with its AUTHMOD binding.", 403, "AUTHMOD_EXTERNAL_IDENTITY_CONFLICT");
  if (identity.status !== "active") throw new FikaSessionError("This AUTHMOD identity is inactive.", 403, "AUTHMOD_IDENTITY_INACTIVE");
  return identity;
}

export async function principalFromSession(repository: AuthModRepository, identity: AuthIdentity, firebaseUid: string): Promise<FikaSessionPrincipal> {
  const custodian = identity.identityKind === "operational" ? await getPrimaryCustodian(repository, identity.id) : undefined;
  return { firebaseUid, authmodIdentityId: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind, ...(identity.representedOplocId ? { representedOplocId: identity.representedOplocId } : {}), ...(custodian?.custodianLegendId ? { primaryCustodianLegendId: custodian.custodianLegendId } : {}) };
}

export async function createFikaSessionCookie(idToken: string, expiresInSeconds = sessionCookieConfig().maxAge, authApi: SessionAuth = auth) {
  if (expiresInSeconds <= 0 || expiresInSeconds > 14 * 24 * 60 * 60) throw new Error("Invalid FIKA session duration.");
  return authApi.createSessionCookie(idToken, { expiresIn: expiresInSeconds * 1000 });
}

export async function requireFikaSession(request: { cookies: { get(name: string): { value?: string } | undefined }; headers?: { get(name: string): string | null } }, repository: AuthModRepository = new FirestoreAuthModRepository(), authApi: SessionAuth = auth): Promise<FikaSessionPrincipal> {
  const cookie = request.cookies.get(sessionCookieConfig().name)?.value;
  if (!cookie) { logAuthDiagnostic(request, { authStage: "firebase-session-cookie-read", status: 401, code: "FIKA_SESSION_MISSING", cookieName: sessionCookieConfig().name }); throw new FikaSessionError("Authentication is required.", 401, "FIKA_SESSION_MISSING"); }
  let decoded: DecodedIdToken;
  try { decoded = await authApi.verifySessionCookie(cookie, true); }
  catch { logAuthDiagnostic(request, { authStage: "firebase-session-cookie-verification", status: 401, code: "FIKA_SESSION_INVALID", cookieName: sessionCookieConfig().name }); throw new FikaSessionError("The FIKA OS session is invalid or expired."); }
  logAuthDiagnostic(request, { authStage: "firebase-session-cookie-verification", status: 200, code: "FIKA_SESSION_VERIFIED", cookieName: sessionCookieConfig().name });
  const identity = await resolveSessionIdentity(repository, { uid: decoded.uid, email: decoded.email, name: decoded.name });
  logAuthDiagnostic(request, { authStage: "authmod-identity-resolution", status: 200, code: "AUTHMOD_IDENTITY_RESOLVED", cookieName: sessionCookieConfig().name });
  return principalFromSession(repository, identity, decoded.uid);
}

export function cookieOptions() {
  const config = sessionCookieConfig();
  return { httpOnly: true, path: "/", sameSite: "lax" as const, secure: config.secureCookies, maxAge: config.maxAge, ...(config.domain ? { domain: config.domain } : {}) };
}

export function clearCookieOptions() { return { ...cookieOptions(), maxAge: 0, expires: new Date(0) }; }
