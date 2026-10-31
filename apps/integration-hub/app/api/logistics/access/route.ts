import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, evaluateAuthority, resolvePermittedVehicleIds, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { LOGISTICS_MAINTENANCE_AUTHORITIES, type LogisticsDesktopPermissions } from "../../../../../shared/logistics-authority";
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
    const access = await cachedAuthmodAdmission({ identityId: principal.id, appId: "logistics", scope: requestedVehicle || "organisation", authorityAction: "logistics.desktop-and-vehicle", representedOplocId: principal.representedOplocId, primaryCustodianLegendId: session.primaryCustodianLegendId, load: async () => {
      const repository = new FirestoreAuthModRepository();
      const context = createAuthModEvaluationContext(repository, principal);
      const appAccess = await resolveUserAccess(repository, { principal, appId: "logistics" }, context);
      if (!appAccess.allowed) return appAccess;
      const vehicles = await resolvePermittedVehicleIds(repository, { principal, vehicleIds: requestedVehicle ? [requestedVehicle] : undefined }, context);
      if (vehicles.resolutionFailed) return { ...appAccess, allowed: false, reasonCode: "store-unavailable" as const };
      const application = await context.application("logistics");
      if (!application) return { ...appAccess, allowed: false, reasonCode: "store-unavailable" as const };
      const desktop = await Promise.all((["View", "Manage"] as const).map(action =>
        application.standardActions.includes(action)
          ? evaluateAuthority(repository, { principal, appId: "logistics", resource: application.standardResource, action, scope: { kind: "organisation", ids: [] } }, context)
          : Promise.resolve({ allowed: false, reasonCode: "authority-not-granted" as const }),
      ));
      if (desktop.some(item => item.reasonCode === "store-unavailable")) return { ...appAccess, allowed: false, reasonCode: "store-unavailable" as const };
      const desktopPermissions: LogisticsDesktopPermissions = { view: desktop[0].allowed, manage: desktop[1].allowed };
      if (requestedVehicle && !desktopPermissions.view && !vehicles.permittedVehicleIds.includes(requestedVehicle)) return { ...appAccess, allowed: false, reasonCode: "authority-not-granted" as const };
      const maintenance = await Promise.all(LOGISTICS_MAINTENANCE_AUTHORITIES.map(resource => evaluateAuthority(repository, { principal, appId: "logistics", resource, action: "Administer", scope: { kind: "organisation", ids: [] } }, context)));
      if (maintenance.some(item => item.reasonCode === "store-unavailable")) return { ...appAccess, allowed: false, reasonCode: "store-unavailable" as const };
      return { ...appAccess, permittedVehicleIds: vehicles.permittedVehicleIds, desktopPermissions, maintenanceAuthorities: LOGISTICS_MAINTENANCE_AUTHORITIES.filter((_, index) => maintenance[index].allowed) };
    } });
    if (!access.allowed) throw Object.assign(new Error("Your account does not currently have Logistics access."), { status: access.reasonCode === "store-unavailable" ? 503 : 403 });
    logAuthDiagnostic(request, { authStage: "hub-admission-app-access", status: 200, code: "HUB_LOGISTICS_ACCESS_ALLOWED" });
    const resolved = access as typeof access & { permittedVehicleIds?: string[]; desktopPermissions?: LogisticsDesktopPermissions; maintenanceAuthorities?: string[] };
    return NextResponse.json({ principal: { ...principal, permittedVehicleIds: resolved.permittedVehicleIds || [], desktopPermissions: resolved.desktopPermissions || { view: false, manage: false }, maintenanceAuthorities: resolved.maintenanceAuthorities || [] }, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { logAuthDiagnostic(request, { authStage: "hub-admission-failure", status: (error as { status?: number }).status || 500, code: (error as { code?: string }).code || "HUB_ADMISSION_FAILURE" }); return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => withAuthmodRequestContext(() => handleGet(request))); }
