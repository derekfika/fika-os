import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { menuPlanningHubBaseUrl } from "./hub-url";
import type { MenuPublication } from "./menu-publication";

export type MenuActor = {
  uid: string;
  email?: string;
  role: "integration-admin" | "reviewer" | "viewer";
  /** OPLOC scope resolved by the Hub/AuthMod boundary. */
  oplocIds: readonly string[];
  allOplocs: boolean;
  permissions?: MenuWritePermissions;
  oplocRedirects?: Record<string, string>;
  synthetic?: boolean;
};
export type MenuWritePermissions = {
  manageOplocIds: readonly string[];
  publishOplocIds: readonly string[];
  canManageOrganisation: boolean;
  canPublishOrganisation: boolean;
};
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

/**
 * The Hub access contract (apps/integration-hub/app/api/menu-planning/access) returns the
 * AuthMod identity as `principal.id`. `identityId` is accepted only as the legacy spelling.
 * Anything that is not a non-empty string is no identity: callers must fail closed rather than
 * let an empty actor reach an audit trail.
 */
export function canonicalActorId(principal: { id?: unknown; identityId?: unknown } | undefined): string | undefined {
  for (const candidate of [principal?.id, principal?.identityId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export async function resolveMenuActor(request: Pick<NextRequest, "headers">): Promise<MenuActor> {
  try {
    const response = await fetch(`${menuPlanningHubBaseUrl()}/api/menu-planning/access`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store", redirect: "error" });
    const body = await response.json() as { principal?: { id?: unknown; identityId?: unknown; email?: string }; permissions?: Partial<MenuWritePermissions>; scope?: { all?: boolean; ids?: string[] }; oplocRedirects?: Record<string, string>; oplocs?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok || !body.principal) throw failure(body.error?.message || "An authenticated Menu Planning session is required.", response.status || 401);
    const ids = body.scope?.ids || (body.oplocs || []).map(oploc => oploc.id).filter((id): id is string => Boolean(id));
    const uid = canonicalActorId(body.principal);
    if (!uid) throw failure("The authenticated session did not carry a verifiable identity; Menu Planning mutation was not performed.", 401);
    const oplocIds = [...new Set(ids)];
    const permitted = new Set(oplocIds);
    const manageOplocIds = Array.isArray(body.permissions?.manageOplocIds) ? body.permissions.manageOplocIds.filter(id => permitted.has(id)) : [];
    const managed = new Set(manageOplocIds);
    const publishOplocIds = Array.isArray(body.permissions?.publishOplocIds) ? body.permissions.publishOplocIds.filter(id => managed.has(id)) : [];
    const canManageOrganisation = managed.size > 0 && body.permissions?.canManageOrganisation === true;
    const permissions = { manageOplocIds, publishOplocIds, canManageOrganisation, canPublishOrganisation: canManageOrganisation && publishOplocIds.length > 0 && body.permissions?.canPublishOrganisation === true };
    const role = publishOplocIds.length ? "integration-admin" : manageOplocIds.length ? "reviewer" : "viewer";
    return { uid, email: body.principal.email, role, oplocIds, allOplocs: body.scope?.all === true, permissions, oplocRedirects: body.oplocRedirects };
  } catch (error) {
    if (process.env.FIKA_RUNTIME_MODE === "local" && process.env.NODE_ENV !== "production" && !request.headers.get("cookie")) return { uid: "local-menu-planner", email: "admin@local.fika", role: "integration-admin", oplocIds: [], allOplocs: true, synthetic: true };
    if (error && typeof error === "object" && "status" in error) throw error;
    throw failure("Authentication service is unavailable; Menu Planning mutation was not performed.", 503);
  }
}

export function requireMutationActor(actor: MenuActor) { if (actor.role === "viewer") throw failure("This identity is read-only for Menu Planning.", 403); return actor; }
export function actorCanManageOrganisation(actor: MenuActor) { return actor.synthetic === true || actor.permissions?.canManageOrganisation === true; }
export function requireOrganisationMutationActor(actor: MenuActor) {
  requireMutationActor(actor);
  if (!actorCanManageOrganisation(actor)) throw failure("This change requires organisation-wide Menu Planning Manage authority.", 403);
  return actor;
}
/** Catalogue writes require a real Hub-authenticated identity; local synthetic admission is read/test-only here. */
export function requireCatalogueMutationActor(actor: MenuActor) { if (actor.synthetic) throw failure("An authenticated Menu Planning identity is required for catalogue changes.", 401); return requireOrganisationMutationActor(actor); }
export function requirePublicationActor(actor: MenuActor) { if (actor.role !== "integration-admin") throw failure("Publishing or withdrawing a menu requires Manage and Menu Publish authority.", 403); return actor; }

export function actorCanWriteOploc(actor: MenuActor, oplocId: string, action: "manage" | "publish") {
  if (actor.synthetic) return true;
  const ids = action === "manage" ? actor.permissions?.manageOplocIds : actor.permissions?.publishOplocIds;
  return Boolean(ids?.includes(canonicalMenuOplocId(actor, oplocId)));
}

export function actorCanWriteOneOff(actor: MenuActor, action: "manage" | "publish") {
  return actor.allOplocs && (action === "manage" ? actorCanManageOrganisation(actor) : actor.synthetic === true || actor.permissions?.canPublishOrganisation === true);
}

export function actorCanAccessOploc(actor: MenuActor, oplocId?: string) {
  if (actor.allOplocs) return true;
  if (!oplocId) return false;
  return actor.oplocIds.includes(canonicalMenuOplocId(actor, oplocId));
}

function canonicalMenuOplocId(actor: MenuActor, id: string) {
  return actor.oplocRedirects && Object.hasOwn(actor.oplocRedirects, id) ? actor.oplocRedirects[id] : id;
}

export function menuReadScopeKey(actor: MenuActor) {
  const redirects = Object.entries(actor.oplocRedirects || {}).sort(([left], [right]) => left.localeCompare(right));
  // Menu details may contain kitchen notes only while the actor manages the entire service.
  return createHash("sha256").update(JSON.stringify([
    "menu-read-scope-v2", actor.uid, actor.allOplocs, [...actor.oplocIds].sort(), redirects,
    actorCanManageOrganisation(actor), [...(actor.permissions?.manageOplocIds || [])].sort(),
  ])).digest("base64url");
}

export function assertActorCanAccessOploc(actor: MenuActor, oplocId?: string) {
  if (!actorCanAccessOploc(actor, oplocId)) throw failure("This Menu Planning identity is not authorised for the requested OPLOC.", 403);
}

export function scopeMenuSitePax(destinationPax: import("./site-pax").SitePax | undefined, actor: MenuActor) {
  if (!destinationPax || actor.allOplocs) return destinationPax;
  const visible = Object.fromEntries(Object.entries(destinationPax).filter(([key]) => key.startsWith("governed:") && actorCanAccessOploc(actor, key.slice("governed:".length))));
  return Object.keys(visible).length ? visible : undefined;
}

export function actorCanReadAllocation(actor: MenuActor, allocation: { destinationId?: string; oneOffDestinationId?: string; destination?: { kind: "one-off" | "governed"; id: string } }) {
  if (actor.allOplocs) return true;
  if (allocation.oneOffDestinationId || allocation.destination?.kind === "one-off") return false;
  return actorCanAccessOploc(actor, allocation.destination?.id || allocation.destinationId) &&
    (!allocation.destinationId || actorCanAccessOploc(actor, allocation.destinationId));
}

export function scopeMenuPublication(publication: MenuPublication, actor: MenuActor): MenuPublication {
  if (actor.allOplocs) return publication;
  return {
    ...publication,
    // The compressed packet contains the complete organisation-wide week;
    // never return it to an OPLOC-scoped identity.
    weekPacket: undefined,
    compiledSnapshotId: undefined,
    audit: [],
    days: publication.days.map(day => ({
      ...day,
      driveArchive: undefined,
      allergenSignoff: undefined,
      destinationPax: scopeMenuSitePax(day.destinationPax, actor),
      ...(day.retainedSiteLineage ? { retainedSiteLineage: Object.fromEntries(Object.entries(day.retainedSiteLineage).filter(([id]) => actorCanAccessOploc(actor, id))) } : {}),
      entries: day.entries.flatMap(entry => {
        const allocations = entry.allocations.filter(allocation => actorCanReadAllocation(actor, allocation));
        return allocations.length || (!entry.allocations.length && actor.oplocIds.length) ? [{ ...entry, allocations, portions: allocations.reduce((total, allocation) => total + allocation.quantity, 0) }] : [];
      }),
    })).filter(day => day.entries.length > 0 || day.destinationPax),
  };
}
