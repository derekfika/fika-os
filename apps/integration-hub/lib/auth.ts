import { requireFikaSession, type FikaSessionPrincipal } from "./fika-session";
import { FirestoreAuthModRepository, hasAuthmodAdmin } from "./authmod-core";

export type HubRole = "integration-admin" | "reviewer" | "viewer";
export type Actor = { uid: string; name: string; email?: string; role: HubRole; synthetic: boolean };
const LOCAL_ROLE_EMAILS: Record<string, HubRole> = { "admin@local.fika": "integration-admin", "reviewer@local.fika": "reviewer", "viewer@local.fika": "viewer" };

type RequestWithAuthCookie = { cookies: { get(name: string): { value?: string } | undefined } };
export async function requireActor(req: RequestWithAuthCookie, allowed: HubRole[] = ["integration-admin", "reviewer", "viewer"]): Promise<Actor> {
  const principal = await requireFikaSession(req as unknown as { cookies: { get(name: string): { value?: string } | undefined } });
  const actor = await actorFromSession(principal);
  if (!allowed.includes(actor.role)) throw Object.assign(new Error("Your role cannot perform this action."), { status: 403 });
  return actor;
}

export async function actorFromSession(principal: FikaSessionPrincipal): Promise<Actor> {
  const localRole = LOCAL_ROLE_EMAILS[String(principal.email || "").toLowerCase()];
  const role = localRole || (await hasAuthmodAdmin(new FirestoreAuthModRepository(), principal.authmodIdentityId) ? "integration-admin" : "viewer");
  return { uid: principal.firebaseUid, name: principal.displayName, email: principal.email, role, synthetic: Boolean(localRole) };
}

export function canApprove(role: HubRole) { return role === "integration-admin"; }
export function canReview(role: HubRole) { return role !== "viewer"; }
