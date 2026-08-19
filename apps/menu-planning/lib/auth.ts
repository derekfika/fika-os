import type { NextRequest } from "next/server";

export type MenuActor = { uid: string; email?: string; role: "integration-admin" | "reviewer" | "viewer"; synthetic?: boolean };
const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function resolveMenuActor(request: NextRequest): Promise<MenuActor> {
  try {
    const response = await fetch(`${hubBase()}/api/auth/session`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    const body = await response.json() as { actor?: MenuActor; error?: { message?: string } };
    if (!response.ok || !body.actor) throw failure(body.error?.message || "An authenticated Menu Planning session is required.", response.status || 401);
    return body.actor;
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && !request.headers.get("cookie")) return { uid: "local-menu-planner", email: "admin@local.fika", role: "integration-admin", synthetic: true };
    if (error && typeof error === "object" && "status" in error) throw error;
    throw failure("Authentication service is unavailable; Menu Planning mutation was not performed.", 503);
  }
}

export function requireMutationActor(actor: MenuActor) { if (actor.role === "viewer") throw failure("This identity is read-only for Menu Planning.", 403); return actor; }
export function requirePublicationActor(actor: MenuActor) { if (actor.role !== "integration-admin") throw failure("Only an Integration Administrator may publish or withdraw a menu.", 403); return actor; }
