import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { auth } from "@/lib/firebase-admin";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { assertRecentVerifiedFirebaseIdentity, clearCookieOptions, cookieOptions, createFikaSessionCookie, requireFikaSession, resolveSessionIdentity } from "@/lib/fika-session";
import { assertSameOrigin, CSRF_COOKIE, validCsrf } from "@/lib/csrf";
const Body = z.object({ idToken: z.string().min(1), csrfToken: z.string().min(1) }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const body = Body.parse(await request.json()); if (!validCsrf(request.cookies.get(CSRF_COOKIE)?.value, body.csrfToken)) throw Object.assign(new Error("Invalid CSRF token."), { status: 403, code: "FIKA_CSRF_INVALID" }); const decoded = await auth.verifyIdToken(body.idToken, true); assertRecentVerifiedFirebaseIdentity(decoded); const repository = new FirestoreAuthModRepository(); const identity = await resolveSessionIdentity(repository, { uid: decoded.uid, email: decoded.email, name: decoded.name }); const session = await createFikaSessionCookie(body.idToken); const response = NextResponse.json({ authenticated: true, principal: { identityId: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind } }); response.cookies.set("fika_os_session", session, cookieOptions()); return response; } catch (error) { return errorResponse(error); } }
export async function GET(request: NextRequest) { try { const principal = await requireFikaSession(request); return NextResponse.json({ authenticated: true, principal: { identityId: principal.authmodIdentityId, displayName: principal.displayName, email: principal.email, identityKind: principal.identityKind } }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function DELETE() { const response = NextResponse.json({ signedOut: true }); response.cookies.set("fika_os_session", "", clearCookieOptions()); return response; }
