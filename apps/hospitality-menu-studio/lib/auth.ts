import { z } from "zod";

import type { StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { studioRuntime } from "./runtime";

const authResponse = z.object({
  permissions: z.object({ View: z.boolean(), Manage: z.boolean(), Publish: z.boolean() }),
  principal: z.object({ id: z.string().min(1), displayName: z.string().optional() }).optional(),
});
const previewAccess = z.strictObject({
  permissions: z.strictObject({ View: z.literal(true), Manage: z.boolean().optional() }),
  principal: z.strictObject({ id: z.string().min(1), displayName: z.string().optional() }),
});

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
    response = await requestHub(runtime.hub + path, {
      headers: { cookie: studioSessionCookie(runtime, cookie), accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
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
    return { id, name: displayName || "Studio reviewer", canManage: runtime.writes && parsed.data.permissions.Manage === true, canPublish: false };
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

export function assertStudioRequestHost(runtime: ReturnType<typeof studioRuntime>, host: string | null) {
  if (runtime.mode === "staging" && host !== new URL(runtime.origin).host) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Open the Studio preview on its staging domain.");
  }
  if (runtime.fixture && !isLoopbackHost(host)) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Local Studio is available on loopback only.");
  }
}

function isLoopbackHost(host: string | null) {
  return /^(?:localhost|127\.0\.0\.1):\d+$/.test(host || "");
}
