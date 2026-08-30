import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { logAuthDiagnostic } from "../../../../../../shared/auth-diagnostics";

async function handleGet(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, authmodIdentityId: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}) };
    const access = await resolveUserAccess(new FirestoreAuthModRepository(), { principal, appId: "logistics" });
    if (!access.allowed) throw Object.assign(new Error("Your account does not currently have Logistics access."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    logAuthDiagnostic(request, { authStage: "hub-admission-app-access", status: 200, code: "HUB_LOGISTICS_ACCESS_ALLOWED" });
    return NextResponse.json({ principal, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { logAuthDiagnostic(request, { authStage: "hub-admission-failure", status: (error as { status?: number }).status || 500, code: (error as { code?: string }).code || "HUB_ADMISSION_FAILURE" }); return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
