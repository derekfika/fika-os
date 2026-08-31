import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { actorFromSession } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { filterServiceArrangements } from "@/lib/service-arrangements-service";
import { getServiceArrangementsReadPackage, validateServiceArrangementsReadPackage } from "@/lib/service-arrangements-read-package";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const actor = await actorFromSession(session);
    assertPermission(actor, "canonical.view");
    const repository = new FirestoreAuthModRepository();
    const activeOplocs = await repository.listActiveOplocs();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}), ...(session.primaryCustodianLegendId ? { primaryCustodianLegendId: session.primaryCustodianLegendId } : {}) };
    const permittedOplocIds = await resolvePermittedOplocIds({ repository, principal, activeOplocs, appId: request.nextUrl.searchParams.get("appId") || undefined });
    const { value } = await getServiceArrangementsReadPackage();
    const packageOverview = validateServiceArrangementsReadPackage(value);
    const filtered = filterServiceArrangements({ ...packageOverview, today: new Date().toISOString().slice(0, 10) }, { oplocIds: permittedOplocIds, serviceDefinitionId: request.nextUrl.searchParams.get("serviceDefinitionId") || undefined, serviceDate: request.nextUrl.searchParams.get("serviceDate") || undefined });
    return NextResponse.json(filtered, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}
