import type { NextRequest } from "next/server";
import { menuPlanningHubBaseUrl } from "./hub-url";
import type { MenuPublication } from "./menu-publication";

export type MenuActor = {
  uid: string;
  email?: string;
  role: "integration-admin" | "reviewer" | "viewer";
  /** OPLOC scope resolved by the Hub/AuthMod boundary. */
  oplocIds: readonly string[];
  allOplocs: boolean;
  synthetic?: boolean;
};
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function resolveMenuActor(request: NextRequest): Promise<MenuActor> {
  try {
    const response = await fetch(`${menuPlanningHubBaseUrl()}/api/menu-planning/access`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    const body = await response.json() as { principal?: { identityId: string; email?: string }; canManage?: boolean; canPublish?: boolean; scope?: { all?: boolean; ids?: string[] }; oplocs?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok || !body.principal) throw failure(body.error?.message || "An authenticated Menu Planning session is required.", response.status || 401);
    const ids = body.scope?.ids || (body.oplocs || []).map(oploc => oploc.id).filter((id): id is string => Boolean(id));
    return { uid: body.principal.identityId, email: body.principal.email, role: body.canPublish ? "integration-admin" : body.canManage ? "reviewer" : "viewer", oplocIds: [...new Set(ids)], allOplocs: body.scope?.all === true };
  } catch (error) {
    if (process.env.FIKA_RUNTIME_MODE === "local" && process.env.NODE_ENV !== "production" && !request.headers.get("cookie")) return { uid: "local-menu-planner", email: "admin@local.fika", role: "integration-admin", oplocIds: [], allOplocs: true, synthetic: true };
    if (error && typeof error === "object" && "status" in error) throw error;
    throw failure("Authentication service is unavailable; Menu Planning mutation was not performed.", 503);
  }
}

export function requireMutationActor(actor: MenuActor) { if (actor.role === "viewer") throw failure("This identity is read-only for Menu Planning.", 403); return actor; }
export function requirePublicationActor(actor: MenuActor) { if (actor.role !== "integration-admin") throw failure("Only an Integration Administrator may publish or withdraw a menu.", 403); return actor; }

export function actorCanAccessOploc(actor: MenuActor, oplocId?: string) {
  return actor.allOplocs || Boolean(oplocId && actor.oplocIds.includes(oplocId));
}

export function assertActorCanAccessOploc(actor: MenuActor, oplocId?: string) {
  if (!actorCanAccessOploc(actor, oplocId)) throw failure("This Menu Planning identity is not authorised for the requested OPLOC.", 403);
}

export function scopeMenuPublication(publication: MenuPublication, actor: MenuActor): MenuPublication {
  if (actor.allOplocs) return publication;
  return {
    ...publication,
    // The compressed packet contains the complete organisation-wide week;
    // never return it to an OPLOC-scoped identity.
    weekPacket: undefined,
    days: publication.days.map(day => ({
      ...day,
      entries: day.entries
        .map(entry => ({ ...entry, allocations: entry.allocations.filter(allocation => actorCanAccessOploc(actor, allocation.destinationId)) }))
        .filter(entry => entry.allocations.length > 0 || entry.allocations.length === day.entries.find(candidate => candidate.sourceEntryId === entry.sourceEntryId)?.allocations.length),
    })).filter(day => day.entries.length > 0),
  };
}
