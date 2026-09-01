import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const context = createAuthModEvaluationContext(repository, principal);
    const app = await resolveUserAccess(repository, { principal, appId: "cpu-production" }, context);
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have CPU Production access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    const scope = await resolvePermittedOplocIds({ repository, principal, appId: "cpu-production" });
    const packageValue = validateOplocReadPackage((await getOplocReadPackage()).value);
    const oplocs = packageValue.oplocs.filter(oploc => scope.all || scope.ids.has(oploc.canonicalId)).map(oploc => ({ id: oploc.canonicalId, label: oploc.label, active: true }));
    return NextResponse.json({ principal, oplocs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}
