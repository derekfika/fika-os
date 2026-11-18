import { z } from "zod";

import type { StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { studioRuntime } from "./runtime";

const authResponse = z.object({
  permissions: z.object({ View: z.boolean(), Manage: z.boolean(), Publish: z.boolean() }),
  principal: z.object({ id: z.string().min(1), displayName: z.string().optional() }).optional(),
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

  // The only credential forwarded is the caller's existing FIKA session. Hub
  // evaluates the organisation-level Rotations entitlement and person identity.
  let response: Response;
  try {
    response = await requestHub(`${runtime.hub}/api/hospitality-rotations?mode=access`, {
      headers: { cookie: studioSessionCookie(runtime, cookie), accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new StudioProblem(503, "AUTHORITY_UNAVAILABLE", "The Hub could not verify Studio access.");
  }

  if (response.status === 401) throw new StudioProblem(401, "FIKA_SESSION_INVALID", "Your FIKA OS session expired. Sign in again.");
  if (response.status === 403) throw forbidden();
  const parsed = authResponse.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) throw new StudioProblem(503, "AUTHORITY_UNAVAILABLE", "The Hub could not verify Studio access.");
  const { permissions, principal } = parsed.data;
  if (!permissions.View || !permissions.Manage || !principal) throw forbidden();

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

function forbidden() {
  return new StudioProblem(403, "STUDIO_ACCESS_DENIED", "Studio requires Hospitality Rotations management access.");
}

export function requireSameOrigin(request: Request, runtime = studioRuntime()) {
  const origin = request.headers.get("origin");
  const address = new URL(request.url);
  if (!origin || origin !== address.origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Studio changes must come from this site.");
  }
  if (runtime.fixture && !["localhost", "127.0.0.1"].includes(address.hostname)) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Local Studio is available on loopback only.");
  }
}

export function assertLocalPreviewHost(runtime: ReturnType<typeof studioRuntime>, host: string | null) {
  if (runtime.fixture && !/^(?:localhost|127\.0\.0\.1):\d+$/.test(host || "")) {
    throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Local Studio is available on loopback only.");
  }
}
