import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { hotForkBuffetDemand } from "@/lib/hospitality-booking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const fromDate = request.nextUrl.searchParams.get("from") || "";
    const toDateExclusive = request.nextUrl.searchParams.get("to") || "";
    const requestedOplocId = request.nextUrl.searchParams.get("oplocId") || "";
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const access = await resolveUserAccess(repository, { principal, appId: "menu-planning" });
    if (!access.allowed) throw Object.assign(new Error("Menu Planning access is required to view buffet demand."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    const permission = await resolvePermittedOplocIds({ repository, principal, appId: "menu-planning" });
    const readPackage = validateOplocReadPackage((await getOplocReadPackage()).value);
    const oplocIds = requestedOplocId
      ? [readPackage.redirects?.[requestedOplocId] || requestedOplocId]
      : permission.all ? readPackage.oplocs.map(oploc => oploc.canonicalId) : [...permission.ids];
    if (requestedOplocId && !permission.all && !permission.ids.has(oplocIds[0])) throw Object.assign(new Error("This identity is not authorised for the requested Hospitality OPLOC."), { status: 403 });
    const result = await hotForkBuffetDemand(fromDate, toDateExclusive, oplocIds);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
