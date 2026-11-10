import { NextRequest, NextResponse } from "next/server";
import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date") || "";
    const requestedOplocId = request.nextUrl.searchParams.get("oplocId") || "";
    if (!date || !requestedOplocId) throw Object.assign(new Error("A service date and canonical OPLOC are required."), { status: 422 });
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const packageValue = validateOplocReadPackage((await getOplocReadPackage()).value);
    const oplocId = packageValue.redirects?.[requestedOplocId] || requestedOplocId;
    const access = await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId });
    if (!access.allowed) throw Object.assign(new Error("This identity is not authorised to preview menus for the booking OPLOC."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    const base = process.env.FIKA_APP_MENU_PLANNING_URL?.trim();
    if (!base) throw Object.assign(new Error("Menu Planning preview is unavailable."), { status: 503 });
    const menuBase = approvedCredentialedUpstream("menu", base);
    const query = new URLSearchParams({ date, oplocId });
    const upstream = await fetch(`${menuBase}/api/hospitality-menu?${query}`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
    const raw = await upstream.text();
    return new Response(raw, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}