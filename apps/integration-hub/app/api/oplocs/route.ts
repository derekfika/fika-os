import { NextRequest, NextResponse } from "next/server";
import { actorFromSession } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { filterAuthorizedOplocs, resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { cachedAuthmodAdmission, withAuthmodRequestContext } from "@/lib/authmod-admission-cache";

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const actor = await actorFromSession(session);
    assertPermission(actor, "canonical.view");
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}), ...(session.primaryCustodianLegendId ? { primaryCustodianLegendId: session.primaryCustodianLegendId } : {}) };
    const requestedAppId = request.nextUrl.searchParams.get("appId") || undefined;
    const permittedOplocIds = await cachedAuthmodAdmission({ identityId: principal.id, appId: "oplocs", scope: requestedAppId || "organisation", authorityAction: "canonical.view", representedOplocId: principal.representedOplocId, primaryCustodianLegendId: session.primaryCustodianLegendId, load: () => resolvePermittedOplocIds({ repository, principal, appId: requestedAppId }) });
    const { value } = await getOplocReadPackage();
    // The package is display/reference data only. AUTHMOD is evaluated first;
    // package possession or contents never grant an OPLOC entitlement.
    return NextResponse.json(filterAuthorizedOplocs(validateOplocReadPackage(value), permittedOplocIds), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "OPLOC authority is unavailable." } }, { status: Number((error as { status?: number }).status) || 503 });
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.oploc.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => withAuthmodRequestContext(() => handleGet(request)));
}
