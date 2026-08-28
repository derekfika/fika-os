import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { evaluateAuthority, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const totalStarted = performance.now();
    const sessionStarted = performance.now();
    const session = await requireFikaSession(request);
    const sessionMs = performance.now() - sessionStarted;
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const appAccessStarted = performance.now();
    const app = await resolveUserAccess(repository, { principal, appId: "menu-planning" });
    const appAccessMs = performance.now() - appAccessStarted;
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Menu Planning access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    if (request.nextUrl.searchParams.get("mode") === "admission") {
      console.info("Integration Hub Menu Planning admission timing", { sessionMs, appAccessMs, totalMs: performance.now() - totalStarted });
      return NextResponse.json({ principal, allowed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const oplocListStarted = performance.now();
    const activeOplocs = await repository.listActiveOplocs();
    const listActiveOplocsMs = performance.now() - oplocListStarted;
    const oplocs = [];
    let canPublish = false;
    const oplocAccessStarted = performance.now();
    const publishAuthorityStarted = performance.now();
    for (const oploc of activeOplocs) {
      if ((await resolveUserAccess(repository, { principal, appId: "menu-planning", oplocId: oploc.id })).allowed) {
        oplocs.push(oploc);
        canPublish ||= (await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: [oploc.id] } })).allowed;
      }
    }
    const perOplocAccessMs = performance.now() - oplocAccessStarted;
    const publishAuthorityMs = performance.now() - publishAuthorityStarted;
    console.info("Integration Hub Menu Planning access timing", { sessionMs, appAccessMs, listActiveOplocsMs, perOplocAccessMs, publishAuthorityMs, totalMs: performance.now() - totalStarted });
    return NextResponse.json({ principal, oplocs, canManage: true, canPublish }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}
