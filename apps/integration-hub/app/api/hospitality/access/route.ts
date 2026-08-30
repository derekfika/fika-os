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
    const sites = [];
    for (const oploc of activeOplocs) {
      if ((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: oploc.id }, context)).allowed) sites.push(oploc);
    }
    return NextResponse.json({ sites }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
