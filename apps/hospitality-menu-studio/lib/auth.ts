import { z } from "zod";
import { createHash } from "node:crypto";

import type { StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { studioRuntime } from "./runtime";
import { readStudioPublicationPilot } from "./hub-publication";
import { studioUpstream, studioUpstreamHeaders } from "./data-trace";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const authResponse = z.object({
  permissions: z.object({ View: z.boolean(), Manage: z.boolean(), Publish: z.boolean() }),
  principal: z.object({ id: z.string().min(1), displayName: z.string().optional() }).optional(),
});
const previewAccess = z.strictObject({
  permissions: z.strictObject({ View: z.literal(true), Manage: z.boolean().optional() }),
  principal: z.strictObject({ id: z.string().min(1), displayName: z.string().optional() }),
});
const admissionFlights = new WeakMap<typeof fetch, Map<string, Promise<StudioActor>>>();

export async function authoriseStudio(
  cookie: string | undefined,
  runtime = studioRuntime(),
  requestHub: typeof fetch = fetch,
): Promise<StudioActor> {
  if (runtime.fixture) {
    return { id: "local-studio-reviewer", name: "Local reviewer", canManage: true, canPublish: false };
  }
  if (!cookie) throw new StudioProblem(401, "FIKA_SESSION_MISSING", "Sign in to open Hospitality Menu Studio.");

  const path = runtime.mode === "staging" ? "/api/hospitality-studio-access" : "/api/hospitality-rotations?mode=access";
  let response: Response;
  try {
    response = await studioUpstream("hub.studio-admission", () => requestHub(runtime.hub + path, {
      headers: { cookie: studioSessionCookie(runtime, cookie), accept: "application/json", ...studioUpstreamHeaders() },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }));
  } catch {
    throw new StudioProblem(503, "AUTHORITY_UNAVAILABLE", "The Hub could not verify Studio access.");
  }

  if (response.status === 401) throw new StudioProblem(401, "FIKA_SESSION_INVALID", "Your FIKA OS session expired. Sign in again.");
  if (response.status === 403) throw forbidden(runtime.mode);
  const value: unknown = await response.json().catch(() => null);
  if (runtime.mode === "staging") {
    const parsed = previewAccess.safeParse(value);
    if (!response.ok || !parsed.success) throw unavailable();
    const { id, displayName } = parsed.data.principal;
    const canManage = runtime.writes && parsed.data.permissions.Manage === true;
    const pilot = canManage && runtime.publicationPilot
      ? await readStudioPublicationPilot(studioSessionCookie(runtime, cookie), requestHub) : undefined;
    return { id, name: displayName || "Studio reviewer", canManage, canPublish: pilot?.publish === true,
      ...(pilot ? { publicationPilot: pilot } : {}) };
  }
  const parsed = authResponse.safeParse(value);
  if (!response.ok || !parsed.success) throw unavailable();
  const { permissions, principal } = parsed.data;
  if (!permissions.View || !permissions.Manage || !principal) throw forbidden(runtime.mode);

  return {
    id: principal.id,
    name: principal.displayName || "Studio editor",
    canManage: runtime.writes && permissions.Manage,
    canPublish: runtime.writes && permissions.Publish,
  };
}

export function studioReadScope(actor: StudioActor, cookie: string | undefined, runtime: ReturnType<typeof studioRuntime>) {
  const pilot = actor.publicationPilot;
  return createHash("sha256").update(JSON.stringify([
    runtime.mode, runtime.projectId, runtime.databaseId, runtime.hub, cookie ?? null, actor.id,
    actor.canManage, actor.canPublish, pilot ? [pilot.publish, pilot.activateSeasonal, pilot.activateCollection,
      pilot.activateProduct, pilot.oplocId, pilot.menuId, pilot.firstDate, pilot.lastDate] : null,
  ])).digest("hex");
}

export async function authoriseStudioRequest(
  request: Request, cookie: string | undefined, runtime = studioRuntime(), requestHub: typeof fetch = fetch,
) {
  const expected = request.headers.get("x-fika-studio-scope");
  let admission: Promise<StudioActor>;
  if (request.method === "GET" && expected && cookie) {
    const key = createHash("sha256").update(JSON.stringify([runtime.mode, runtime.hub, runtime.name, runtime.writes, cookie, expected])).digest("hex");
    let flights = admissionFlights.get(requestHub);
    if (!flights) { flights = new Map(); admissionFlights.set(requestHub, flights); }
    const pending = flights.get(key);
    if (pending) {
      recordDataAccess({ operation: "hub.studio-admission", source: "MEMORY", documents: 0, cacheResult: "IN_FLIGHT_JOIN" });
      admission = pending;
    } else {
      admission = authoriseStudio(cookie, runtime, requestHub).finally(() => flights.delete(key));
      flights.set(key, admission);
    }
  } else admission = authoriseStudio(cookie, runtime, requestHub);
  const actor = await admission;
  if (expected !== null && studioReadScope(actor, cookie, runtime) !== expected) {
    throw new StudioProblem(403, "STUDIO_SCOPE_CHANGED", "Your Studio session or access changed. Reopen Studio to continue.");
  }
  return actor;
}

export function studioSessionCookie(runtime: ReturnType<typeof studioRuntime>, cookie: string) {
  return `${runtime.name}=${encodeURIComponent(cookie)}`;
}

function forbidden(mode: string) {
  return new StudioProblem(403, "STUDIO_ACCESS_DENIED", mode === "staging"
    ? "This account does not have Studio staging preview access." : "Studio requires Hospitality Rotations management access.");
}

function unavailable() {
  return new StudioProblem(503, "AUTHORITY_UNAVAILABLE", "The Hub could not verify Studio access.");
}

export function studioSignIn(runtime: ReturnType<typeof studioRuntime>, failure: StudioProblem) {
  if (runtime.mode !== "staging") return runtime.hub;
  const url = new URL("/", runtime.hub);
  url.searchParams.set("appId", "hospitality-menu-studio");
  url.searchParams.set("returnTo", runtime.origin + "/");
  url.searchParams.set("launchError", failure.code);
  return url.href;
}

export function requireSameOrigin(request: Request, runtime = studioRuntime()) {
  const origin = request.headers.get("origin");
  const address = new URL(request.url);
  // Next can normalize the request URL to localhost even for a 127.0.0.1 request.
  // The governed dev server binds to loopback, and only a loopback Host is accepted here.
  const host = request.headers.get("host") || address.host;
  const expectedOrigin = runtime.mode === "local"
    ? isLoopbackHost(host) ? "http://" + host : null
    : runtime.origin;
  assertStudioRequestHost(runtime, host);
  if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Studio changes must come from this site.");
  }
}

const STAGING_STUDIO_RUN_HOST = "fika-menu-studio-staging-594727519934.europe-west4.run.app";

export function assertStudioRequestHost(runtime: ReturnType<typeof studioRuntime>, host: string | null) {
  // The managed proxy rewrites Host. Browser changes still require the exact configured origin.
  if (runtime.mode === "staging" && host !== new URL(runtime.origin).host && host !== STAGING_STUDIO_RUN_HOST) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Open the Studio preview on its staging domain.");
  }
  if (runtime.fixture && !isLoopbackHost(host)) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Local Studio is available on loopback only.");
  }
}

function isLoopbackHost(host: string | null) {
  return /^(?:localhost|127\.0\.0\.1):\d+$/.test(host || "");
}
