import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const activeOplocs = await repository.listActiveOplocs();
    const context = createAuthModEvaluationContext(repository, principal, activeOplocs);
    const app = await resolveUserAccess(repository, { principal, appId: "cpu-production" }, context);
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have CPU Production access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    const oplocs = [];
    for (const oploc of activeOplocs) {
      if ((await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId: oploc.id }, context)).allowed) oplocs.push(oploc);
    }
    return NextResponse.json({ principal, oplocs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}
