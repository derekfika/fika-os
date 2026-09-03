import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, evaluateAuthority, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const totalStarted = performance.now();
    const sessionStarted = performance.now();
    const session = await requireFikaSession(request);
    const sessionMs = performance.now() - sessionStarted;
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    if (request.nextUrl.searchParams.get("mode") !== "admission") {
      const context = createAuthModEvaluationContext(repository, principal);
      const appAccessStarted = performance.now();
      const app = await resolveUserAccess(repository, { principal, appId: "menu-planning" }, context);
      const appAccessMs = performance.now() - appAccessStarted;
      if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Menu Planning access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
      const scope = await resolvePermittedOplocIds({ repository, principal, appId: "menu-planning" });
      const packageValue = validateOplocReadPackage((await getOplocReadPackage()).value);
      const oplocs = packageValue.oplocs.filter(oploc => scope.all || scope.ids.has(oploc.canonicalId)).map(oploc => ({ id: oploc.canonicalId, label: oploc.label, active: true }));
      let canManage = false;
      let canPublish = false;
      const oplocAccessStarted = performance.now();
      const manageAuthorityStarted = performance.now();
      // Manage is a normal Menu Planning authority and must be evaluated
      // against each OPLOC the identity is actually permitted to use. The
      // prior unconditional response made every admitted identity a writer.
      for (const oploc of oplocs) {
        canManage ||= (await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu-planning.normal", action: "Manage", scope: { kind: "oploc", ids: [oploc.id] } }, context)).allowed;
      }
      const manageAuthorityMs = performance.now() - manageAuthorityStarted;
      const publishAuthorityStarted = performance.now();
      // Menu Publish is an explicit organisation-wide authority. Keep the
      // OPLOC checks as a bounded compatibility fallback for grants created
      // before the authority became organisation-wide.
      canPublish = (await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "organisation", ids: [] } }, context)).allowed;
      for (const oploc of canPublish ? [] : oplocs) {
        canPublish ||= (await evaluateAuthority(repository, { principal, appId: "menu-planning", resource: "menu.publish", action: "Publish", scope: { kind: "oploc", ids: [oploc.id] } }, context)).allowed;
      }
      const perOplocAccessMs = performance.now() - oplocAccessStarted;
      const publishAuthorityMs = performance.now() - publishAuthorityStarted;
      console.info("Integration Hub Menu Planning access timing", { sessionMs, appAccessMs, perOplocAccessMs, manageAuthorityMs, publishAuthorityMs, totalMs: performance.now() - totalStarted });
      return NextResponse.json({ principal, oplocs, scope: { all: scope.all, ids: [...scope.ids] }, canManage, canPublish }, { headers: { "Cache-Control": "no-store" } });
    }
    const context = createAuthModEvaluationContext(repository, principal);
    const appAccessStarted = performance.now();
    const app = await resolveUserAccess(repository, { principal, appId: "menu-planning" }, context);
    const appAccessMs = performance.now() - appAccessStarted;
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Menu Planning access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    console.info("Integration Hub Menu Planning admission timing", { sessionMs, appAccessMs, totalMs: performance.now() - totalStarted });
    return NextResponse.json({ principal, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}
