import { NextRequest, NextResponse } from "next/server";
import { actorFromSession } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { getServiceArrangementsReadPackage, validateServiceArrangementsReadPackage } from "@/lib/service-arrangements-read-package";
import { DELIVERED_IN_PERMISSIONS } from "@fika/server-shared/delivered-in-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const actor = await actorFromSession(session);
    assertPermission(actor, "canonical.view");
    const service = request.nextUrl.searchParams.get("service") === "grab-and-go" ? "grab-and-go" : "delivered-in";
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const [scope, packageResult, servicePackageResult] = await Promise.all([
      resolvePermittedOplocIds({ repository, principal, appId: "delivered-in" }),
      getOplocReadPackage(),
      getServiceArrangementsReadPackage(),
    ]);
    const packageValue = validateOplocReadPackage(packageResult.value);
    const servicePackage = validateServiceArrangementsReadPackage(servicePackageResult.value);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const enabledFor = (requestedService: "delivered-in" | "grab-and-go") => {
      const definitions = new Set(servicePackage.serviceDefinitions.filter(definition => {
        const name = definition.label.toLowerCase().replaceAll("&", "and");
        const matches = requestedService === "grab-and-go" ? name.includes("grab") && name.includes("go") : name.includes("delivered") && name.includes("in");
        return matches;
      }).map(definition => definition.canonicalId));
      return new Set(servicePackage.arrangements.filter(arrangement => definitions.has(arrangement.serviceDefinitionId) && arrangement.lifecycleState === "active" && arrangement.effectiveFrom <= today && (!arrangement.effectiveTo || arrangement.effectiveTo >= today)).map(arrangement => arrangement.oplocId));
    };
    const enabled = enabledFor(service);
    const deliveredIn = enabledFor("delivered-in");
    const grabAndGo = enabledFor("grab-and-go");
    const authorized = packageValue.oplocs.filter(oploc => (scope.all || scope.ids.has(oploc.canonicalId)) && enabled.has(oploc.canonicalId));
    return NextResponse.json({ access: { email: session.email || "", oplocIds: authorized.map(oploc => oploc.canonicalId), permissions: [...DELIVERED_IN_PERMISSIONS] }, sites: authorized.map(oploc => ({ oplocId: oploc.canonicalId, label: oploc.label, services: { deliveredIn: deliveredIn.has(oploc.canonicalId), grabAndGo: grabAndGo.has(oploc.canonicalId) } })) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In access could not be resolved." } }, { status: Number((error as { status?: number }).status) || 403 });
  }
}
