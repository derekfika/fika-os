import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { MENU_PLANNING_APP, readMenuPlanningWritePermissions } from "@/lib/menu-planning-permissions";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { requireFikaSession } from "@/lib/fika-session";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) {
  try {
    const totalStarted = performance.now();
    const sessionStarted = performance.now();
    const session = await requireFikaSession(request);
    const sessionMs = performance.now() - sessionStarted;
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const context = createAuthModEvaluationContext(repository, principal);
    const appAccessStarted = performance.now();
    const app = await resolveUserAccess(repository, { principal, appId: MENU_PLANNING_APP }, context);
    const appAccessMs = performance.now() - appAccessStarted;
    if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Menu Planning access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
    const headers = { "Cache-Control": "no-store" };
    if (request.nextUrl.searchParams.get("mode") === "admission") {
      console.info("Integration Hub Menu Planning admission timing", { sessionMs, appAccessMs, totalMs: performance.now() - totalStarted });
      return NextResponse.json({ principal, allowed: true }, { headers });
    }
    const scopeStarted = performance.now();
    const packageValue = validateOplocReadPackage((await getOplocReadPackage()).value);
    const sites = packageValue.oplocs.map(oploc => ({ id: oploc.canonicalId, label: oploc.label, active: true }));
    context.seedOplocPackage(sites, packageValue.redirects);
    const scope = await resolvePermittedOplocIds({ repository, principal, appId: MENU_PLANNING_APP }, context);
    const oplocs = sites.filter(oploc => scope.all || scope.ids.has(oploc.id));
    const scopeMs = performance.now() - scopeStarted;
    const permissions = await readMenuPlanningWritePermissions(repository, principal, oplocs.map(oploc => oploc.id), context);
    console.info("Integration Hub Menu Planning access timing", { sessionMs, appAccessMs, scopeMs, permissionMs: performance.now() - scopeStarted - scopeMs, totalMs: performance.now() - totalStarted });
    return NextResponse.json({
      principal, oplocs, scope: { all: scope.all, ids: oplocs.map(oploc => oploc.id) },
      canManage: permissions.manageOplocIds.length > 0, canPublish: permissions.publishOplocIds.length > 0,
      permissions,
    }, { headers });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.menu-planning-admission", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
