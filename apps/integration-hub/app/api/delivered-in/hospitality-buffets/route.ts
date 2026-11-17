import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { actorFromSession } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { getServiceArrangementsReadPackage, validateServiceArrangementsReadPackage } from "@/lib/service-arrangements-read-package";
import { db } from "@/lib/firebase-admin";
import type { ProductionOrder } from "@/lib/production-domain";
import { projectDeliveredInBuffetOrders } from "@/lib/hospitality-buffet-read-model";

export const dynamic = "force-dynamic";
const MAX_SERVICE_DATE_ORDERS = 500;

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function handleGet(request: NextRequest) {
  const oplocId = request.nextUrl.searchParams.get("oplocId");
  const serviceDate = request.nextUrl.searchParams.get("serviceDate");
  if (!oplocId || !validDate(serviceDate)) return NextResponse.json({ error: { message: "A canonical OPLOC and valid service date are required." } }, { status: 422 });

  const session = await requireFikaSession(request);
  const actor = await actorFromSession(session);
  assertPermission(actor, "canonical.view");
  const repository = new FirestoreAuthModRepository();
  const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
  const [scope, oplocResult, serviceResult] = await Promise.all([
    resolvePermittedOplocIds({ repository, principal, appId: "delivered-in" }),
    getOplocReadPackage(),
    getServiceArrangementsReadPackage(),
  ]);
  const oplocs = validateOplocReadPackage(oplocResult.value).oplocs;
  const requestedOploc = oplocs.find(oploc => oploc.canonicalId === oplocId);
  if (!requestedOploc || !(scope.all || scope.ids.has(requestedOploc.canonicalId))) throw Object.assign(new Error("You are not authorised to view this Delivered-In site."), { status: 403 });

  const servicePackage = validateServiceArrangementsReadPackage(serviceResult.value);
  const deliveredInDefinitions = new Set(servicePackage.serviceDefinitions.filter(definition => {
    const label = definition.label.toLowerCase().replaceAll("&", "and");
    return label.includes("delivered") && label.includes("in");
  }).map(definition => definition.canonicalId));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const serviceIsActive = servicePackage.arrangements.some(arrangement => arrangement.oplocId === requestedOploc.canonicalId && deliveredInDefinitions.has(arrangement.serviceDefinitionId) && arrangement.lifecycleState === "active" && arrangement.effectiveFrom <= today && (!arrangement.effectiveTo || arrangement.effectiveTo >= today));
  if (!serviceIsActive) throw Object.assign(new Error("Delivered-In service is not active for this site."), { status: 403 });

  const snapshot = await db.collection("fikaProductionOrdersV1").where("serviceDate", "==", serviceDate).limit(MAX_SERVICE_DATE_ORDERS + 1).get();
  recordDataAccess({ app: "integration-hub", operation: "delivered-in.hospitality-buffet-orders.by-service-date", source: "FIRESTORE", dataset: "fikaProductionOrdersV1", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
  if (snapshot.size > MAX_SERVICE_DATE_ORDERS) throw Object.assign(new Error("The service-date production read exceeds its safe limit."), { status: 503, code: "DELIVERED_IN_BUFFET_READ_LIMIT" });
  return NextResponse.json({ orders: projectDeliveredInBuffetOrders(snapshot.docs.map(document => document.data() as ProductionOrder), { serviceDate, oplocId: requestedOploc.canonicalId }) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.delivered-in.hospitality-buffets.read", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, async () => {
    try { return await handleGet(request); }
    catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Hospitality buffet service data is unavailable.", ...((error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") ? { code: (error as { code: string }).code } : {}) } }, { status: Number((error as { status?: number }).status) || 502 }); }
  });
}
