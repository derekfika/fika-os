import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { auth } from "@/lib/firebase-admin";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { cookieOptions, createFikaSessionCookie } from "@/lib/fika-session";
import { ensureLocalFixtureIdentity, localFixture, signInLocalFixture } from "@/lib/local-auth-bootstrap";
const Body = z.object({ role: z.enum(["integration-admin", "reviewer", "viewer"]) }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const { role } = Body.parse(await request.json()); const token = await signInLocalFixture(role); const decoded = await auth.verifyIdToken(token.idToken); const repository = new FirestoreAuthModRepository(); await ensureLocalFixtureIdentity(repository, role, decoded.uid); const session = await createFikaSessionCookie(token.idToken); const fixture = localFixture(role); const response = NextResponse.json({ actor: { uid: decoded.uid, name: fixture.name, email: fixture.email, role, synthetic: true } }); response.cookies.set("fika_os_session", session, cookieOptions()); return response; } catch (error) { return errorResponse(error); } }
export async function DELETE() { const response = NextResponse.json({ signedOut: true }); response.cookies.set("fika_os_session", "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) }); return response; }
