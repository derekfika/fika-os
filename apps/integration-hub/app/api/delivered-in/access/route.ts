import { NextRequest, NextResponse } from "next/server";
import { actorFromSession } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { db } from "@/lib/firebase-admin";
import { requireFikaSession } from "@/lib/fika-session";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
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
    const [scope, packageResult, serviceRecords] = await Promise.all([
      resolvePermittedOplocIds({ repository, principal, appId: "delivered-in" }),
      getOplocReadPackage(),
      db.collection("integrationHubCanonical").where("entityType", "in", ["Service Definition", "Service Arrangement"]).get(),
    ]);
    const packageValue = validateOplocReadPackage(packageResult.value);
    const records = serviceRecords.docs.map(document => document.data());
    const today = new Date().toISOString().slice(0, 10);
    const enabledFor = (requestedService: "delivered-in" | "grab-and-go") => {
      const definitions = new Set(records.filter(record => {
        const name = String(record.record?.serviceName || "").toLowerCase().replaceAll("&", "and");
        const matches = requestedService === "grab-and-go" ? name.includes("grab") && name.includes("go") : name.includes("delivered") && name.includes("in");
        return record.entityType === "Service Definition" && record.lifecycleStatus !== "archived" && record.record?.lifecycleState === "active" && matches;
      }).map(record => String(record.canonicalId)));
      return new Set(records.filter(record => record.entityType === "Service Arrangement" && record.lifecycleStatus !== "archived" && record.record?.lifecycleState === "active" && definitions.has(String(record.record?.serviceDefinitionId || "")) && String(record.record?.effectiveFrom || "") <= today && (!record.record?.effectiveTo || String(record.record.effectiveTo) >= today)).map(record => String(record.record?.oplocId || "")));
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
