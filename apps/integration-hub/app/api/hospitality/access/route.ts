import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const sites = [];
    for (const oploc of await repository.listActiveOplocs()) {
      if ((await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: oploc.id })).allowed) sites.push(oploc);
    }
    return NextResponse.json({ sites }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
