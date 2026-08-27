import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { evaluateAuthority, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const app = await resolveUserAccess(repository, { principal, appId: "menu-planning" });
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Menu Planning access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    const oplocs = [];
    let canPublish = false;
    for (const oploc of await repository.listActiveOplocs()) {
      if ((await resolveUserAccess(repository, { principal, appId: "menu-planning", oplocId: oploc.id })).allowed) {
        oplocs.push(oploc);
        canPublish ||= (await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: [oploc.id] } })).allowed;
      }
    }
    return NextResponse.json({ principal, oplocs, canManage: true, canPublish }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
