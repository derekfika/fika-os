import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertLocalSafety } from "@/lib/safety";
import { errorResponse } from "@/lib/api";

const Request = z.object({ role: z.enum(["integration-admin", "reviewer", "viewer"]) }).strict();
const EMAILS = { "integration-admin": "admin@local.fika", reviewer: "reviewer@local.fika", viewer: "viewer@local.fika" } as const;
const PASSWORD = "Synthetic-Local-Only-2026!";

export async function POST(req: NextRequest) {
  try {
    const { authHost } = assertLocalSafety();
    const { role } = Request.parse(await req.json());
    const email = EMAILS[role];
    const endpoint = `http://${authHost}/identitytoolkit.googleapis.com/v1`;
    let response = await fetch(`${endpoint}/accounts:signInWithPassword?key=local-only`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) });
    if (!response.ok) response = await fetch(`${endpoint}/accounts:signUp?key=local-only`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) });
    if (!response.ok) throw Object.assign(new Error("Local Authentication emulator is unavailable."), { status: 503 });
    const data = await response.json() as { idToken: string };
    const result = NextResponse.json({ actor: { name: role === "integration-admin" ? "Integration Administrator" : role === "reviewer" ? "Integration Reviewer" : "Integration Viewer", email, role, synthetic: true } });
    result.cookies.set("fika_hub_token", data.idToken, { httpOnly: true, sameSite: "strict", secure: false, maxAge: 3600, path: "/" });
    return result;
  } catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  const result = NextResponse.json({ signedOut: true });
  result.cookies.set("fika_hub_token", "", { maxAge: 0, path: "/" });
  return result;
}
