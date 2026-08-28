import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const access = await resolveUserAccess(new FirestoreAuthModRepository(), { principal, appId: "logistics" });
    if (!access.allowed) throw Object.assign(new Error("Your account does not currently have Logistics access."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    return NextResponse.json({ principal, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
