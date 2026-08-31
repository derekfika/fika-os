import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolvePermittedVehicleIds, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { cachedAuthmodAdmission, withAuthmodRequestContext } from "@/lib/authmod-admission-cache";
import { logAuthDiagnostic } from "../../../../../../shared/auth-diagnostics";

async function handleGet(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, authmodIdentityId: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}) };
    const requestedVehicle = request.nextUrl.searchParams.get("vehicle") || undefined;
    if (requestedVehicle && requestedVehicle !== "van1" && requestedVehicle !== "van2") throw Object.assign(new Error("Invalid Logistics vehicle context."), { status: 403, code: "AUTHMOD_VEHICLE_DENIED" });
    const access = await cachedAuthmodAdmission({ identityId: principal.id, appId: "logistics", scope: requestedVehicle || "organisation", authorityAction: "logistics.vehicle.view", representedOplocId: principal.representedOplocId, primaryCustodianLegendId: session.primaryCustodianLegendId, load: async () => {
      const repository = new FirestoreAuthModRepository();
      const context = createAuthModEvaluationContext(repository, principal);
      const appAccess = await resolveUserAccess(repository, { principal, appId: "logistics" }, context);
      if (!appAccess.allowed) return appAccess;
      const vehicles = await resolvePermittedVehicleIds(repository, { principal, vehicleIds: requestedVehicle ? [requestedVehicle] : undefined }, context);
      if (vehicles.resolutionFailed) return { ...appAccess, allowed: false, reasonCode: "store-unavailable" as const };
      if (requestedVehicle && !vehicles.permittedVehicleIds.includes(requestedVehicle)) return { ...appAccess, allowed: false, reasonCode: "authority-not-granted" as const };
      return { ...appAccess, permittedVehicleIds: vehicles.permittedVehicleIds };
    } });
    if (!access.allowed) throw Object.assign(new Error("Your account does not currently have Logistics access."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    logAuthDiagnostic(request, { authStage: "hub-admission-app-access", status: 200, code: "HUB_LOGISTICS_ACCESS_ALLOWED" });
    return NextResponse.json({ principal: { ...principal, permittedVehicleIds: (access as typeof access & { permittedVehicleIds?: string[] }).permittedVehicleIds || [] }, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { logAuthDiagnostic(request, { authStage: "hub-admission-failure", status: (error as { status?: number }).status || 500, code: (error as { code?: string }).code || "HUB_ADMISSION_FAILURE" }); return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => withAuthmodRequestContext(() => handleGet(request))); }
