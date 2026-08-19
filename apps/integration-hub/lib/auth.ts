import { auth } from "./firebase-admin";

export type HubRole = "integration-admin" | "reviewer" | "viewer";
export type Actor = { uid: string; name: string; email?: string; role: HubRole; synthetic: true };
const ROLE_EMAILS: Record<string, Actor> = {
  "admin@local.fika": { uid: "", name: "Integration Administrator", email: "admin@local.fika", role: "integration-admin", synthetic: true },
  "reviewer@local.fika": { uid: "", name: "Integration Reviewer", email: "reviewer@local.fika", role: "reviewer", synthetic: true },
  "viewer@local.fika": { uid: "", name: "Integration Viewer", email: "viewer@local.fika", role: "viewer", synthetic: true },
};

type RequestWithAuthCookie = { cookies: { get(name: string): { value?: string } | undefined } };
export async function requireActor(req: RequestWithAuthCookie, allowed: HubRole[] = ["integration-admin", "reviewer", "viewer"]): Promise<Actor> {
  const token = req.cookies.get("fika_hub_token")?.value;
  if (!token) throw Object.assign(new Error("Sign in with a synthetic local identity."), { status: 401 });
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch (error) {
    const authError = error as { code?: string; message?: string };
    const invalidSession = new Set([
      "auth/argument-error",
      "auth/id-token-expired",
      "auth/id-token-revoked",
      "auth/invalid-id-token",
      "auth/user-disabled",
      "auth/user-not-found",
    ]);
    if (
      invalidSession.has(authError.code || "") ||
      /(?:ID token|session).*(?:expired|invalid|revoked)/i.test(authError.message || "")
    ) {
      throw Object.assign(
        new Error("Your local session expired after the emulator data changed. Sign in again."),
        { status: 401, code: "LOCAL_SESSION_EXPIRED" },
      );
    }
    throw error;
  }
  const base = ROLE_EMAILS[String(decoded.email || "").toLowerCase()];
  if (!base) throw Object.assign(new Error("Unknown local identity."), { status: 403 });
  const actor = { ...base, uid: decoded.uid };
  if (!allowed.includes(actor.role)) throw Object.assign(new Error("Your role cannot perform this action."), { status: 403 });
  return actor;
}

export function canApprove(role: HubRole) { return role === "integration-admin"; }
export function canReview(role: HubRole) { return role !== "viewer"; }
