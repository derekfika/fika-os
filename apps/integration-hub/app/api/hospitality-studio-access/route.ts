import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { isStudioAuthHubRequestHost, readStudioPreviewAccess, STUDIO_AUTH_HUB_ORIGIN } from "@/lib/authmod-core/hospitality-studio-admission";
import { assertRecentVerifiedFirebaseIdentity, cookieOptions, createFikaSessionCookie, requireBoundFikaSession, resolveSessionIdentity } from "@/lib/fika-session";
import { auth, db } from "@/lib/firebase-admin";
import { sessionCookieConfig } from "@/lib/runtime-config";
import { csrfCookieName, validCsrf } from "@/lib/csrf";
import { hospitalityTraceRequestId } from "@/lib/hospitality-catalogue-trace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const exchange = z.strictObject({ idToken: z.string().min(1), csrfToken: z.string().min(1) });

function studioSession(request: NextRequest, action: string, run: () => Promise<Response>) {
  return withDataTrace({
    app: "integration-hub", action, path: "/api/hospitality-studio-access", requestId: hospitalityTraceRequestId(request),
  }, async () => {
    try {
      const runtime = sessionCookieConfig();
      if (runtime.mode !== "staging" || runtime.projectId !== "fika-os-dev" || runtime.domain !== ".fikacatering.com") return problem(404);
      if (!isStudioAuthHubRequestHost(request.headers.get("host"))) return problem(403);
      return await run();
    } catch (error) {
      const status = (error as { status?: number }).status;
      return problem(status === 401 || status === 403 ? status : 503);
    }
  });
}

type Session = Parameters<typeof readStudioPreviewAccess>[1];
function checkAccess(session: (repository: FirestoreAuthModRepository) => Promise<Session>) {
  return db.runTransaction(async transaction => {
    const repository = new FirestoreAuthModRepository("hospitality-studio-access", undefined, transaction);
    return readStudioPreviewAccess({
      getApplication: id => repository.getApplication(id),
      readCurrentAccess: id => repository.getRuntimeAccessPackage(id),
    }, await session(repository));
  }, { readOnly: true });
}

export function GET(request: NextRequest) {
  return studioSession(request, "integration-hub.hospitality-studio-access.read", async () => {
    const access = await checkAccess(repository => requireBoundFikaSession(request, repository));
    return access ? Response.json(access, { headers }) : problem(403);
  });
}

export function POST(request: NextRequest) {
  return studioSession(request, "integration-hub.hospitality-studio-access.sign-in", async () => {
    // Browser origin and the CSRF token are independent of the upstream Host rewrite.
    if (request.headers.get("origin") !== STUDIO_AUTH_HUB_ORIGIN || request.headers.get("sec-fetch-site") === "cross-site") {
      return problem(403);
    }
    const body = exchange.safeParse(await request.json().catch(() => null));
    if (!body.success || !validCsrf(request.cookies.get(csrfCookieName())?.value, body.data.csrfToken)) return problem(403);
    const { idToken } = body.data;
    const decoded = await auth.verifyIdToken(idToken, true).catch(() => null);
    if (!decoded) return problem(401);
    assertRecentVerifiedFirebaseIdentity(decoded);
    const access = await checkAccess(async repository => {
      const identity = await resolveSessionIdentity(repository, {
        uid: decoded.uid, email: decoded.email, name: decoded.name,
      }, undefined, false);
      return { authmodIdentityId: identity.id, firebaseUid: decoded.uid, identityKind: identity.identityKind };
    });
    if (!access) return problem(403);
    const response = NextResponse.json({ authenticated: true }, { headers });
    response.cookies.set(sessionCookieConfig().name, await createFikaSessionCookie(idToken), cookieOptions());
    return response;
  });
}

function problem(status: number) {
  const code = status === 401 ? "FIKA_SESSION_INVALID" : status === 403 ? "STUDIO_ACCESS_DENIED"
    : status === 404 ? "STUDIO_ACCESS_DISABLED" : "STUDIO_AUTHORITY_UNAVAILABLE";
  return Response.json({ error: { code } }, { status, headers });
}
