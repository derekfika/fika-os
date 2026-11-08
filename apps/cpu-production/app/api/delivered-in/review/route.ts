import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { NextRequest, NextResponse } from "next/server";
import { productionQueue } from "../../../../lib/production-http-client";
import { loadPlansForOrders } from "../../../../lib/cpu-projection-repository";
import { allergenMatrixHtml } from "../../../ui/allergen-matrix";
import { renderPdfToBuffer } from "../../../lib/local-pdf";
import { getCpuReviewPackage, recordCpuReviewFallback, rebuildCpuReviewPackage } from "../../../../lib/cpu-review-package";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { cpuDestinationAllowed, requireCpuActor, resolveCpuDestinationScope } from "../../../../lib/cpu-access-client";
import { currentAllergenReleaseMatchesOrder, type ProductionPlan } from "../../../lib/production-plan";

export const dynamic = "force-dynamic";

type ReviewState = "clear" | "contains" | "may_contain" | "unrecorded";
type ReviewSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor?: string; attestation?: string; signatureDataUrl?: string };
type ReviewPlan = Pick<ProductionPlan, "orderId" | "signatures" | "menuItems" | "currentAllergenRelease">;

async function sitePdf(request: NextRequest, serviceDate: string, oplocId: string, orders: Awaited<ReturnType<typeof productionQueue>>, plans: Map<string, ReviewPlan>, signatures: ReviewSignature[]) {
  const siteOrders = orders.filter(order => order.destinationOplocId === oplocId);
  const sourceOrder = siteOrders[0];
  if (!sourceOrder) return undefined;
  const menuItems = siteOrders.flatMap(order => plans.get(order.canonicalId)?.menuItems || []).map(item => ({
    ...item,
    subItems: (item.subItems || []).map(sub => ({ ...sub, allergens: sub.allergens || {} })),
  }));
  if (!menuItems.length) return undefined;
  const html = allergenMatrixHtml({
    clientName: "FIKA OS",
    destinationLabel: sourceOrder.destinationLabel,
    serviceType: "Delivered-In menu",
    serviceDate,
    serviceWindow: sourceOrder.serviceWindow,
    requiredBy: sourceOrder.requiredBy,
  }, menuItems, signatures as never);
  const fileName = `${serviceDate}_${(sourceOrder.destinationLabel || oplocId).replace(/[^A-Za-z0-9._-]+/g, "_")}_Delivered-In_Allergen-Matrix.pdf`;
  return new NextResponse(await renderPdfToBuffer(html), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "no-store, max-age=0" } });
}

async function handleGet(request: NextRequest) {
  const serviceDate = request.nextUrl.searchParams.get("serviceDate");
  const oplocId = request.nextUrl.searchParams.get("oplocId");
  if (!serviceDate || !oplocId) return NextResponse.json({ error: { message: "A service date and OPLOC are required." } }, { status: 422 });
  try {
    await requireCpuActor(request);
    const destinationScope = await resolveCpuDestinationScope(request, [oplocId]);
    if (!cpuDestinationAllowed(destinationScope, oplocId)) return NextResponse.json({ error: { message: "This destination is outside your CPU Production access scope." } }, { status: 403 });
    const driveBlocked = await stagingDriveAccessBlocked();
    if (driveBlocked && request.nextUrl.searchParams.get("download") === "pdf") return NextResponse.json({ error: { message: "The PDF is unavailable while Drive isolation is unverified." } }, { status: 404 });
    const reconcile = request.nextUrl.searchParams.get("reconcile") === "1";
    if (!reconcile) {
      try {
        const packaged = request.nextUrl.searchParams.get("download") === "pdf" ? undefined : await getCpuReviewPackage(serviceDate, oplocId);
        if (packaged) {
          const sourceOrders = packaged.value.projection.sourceOrders;
          const signatureList = packaged.value.projection.signatures;
          const signed = sourceOrders.length > 0 && sourceOrders.every(order => order.reviewStatus === "signed") && signatureList.some(signature => signature.role === "production_chef") && signatureList.some(signature => signature.role === "head_chef_site_manager");
          const currentOrders = (await productionQueue(request, serviceDate)).filter(order => order.origin === "menu_planning" && order.destinationOplocId === oplocId && order.status !== "cancelled" && !order.supersededBy);
          const packagedVersions = new Map(sourceOrders.map(order => [order.productionOrderId, order.orderVersion]));
          const sourceCurrent = currentOrders.length === sourceOrders.length && currentOrders.every(order => packagedVersions.get(order.canonicalId) === order.version);
          if (!sourceCurrent) {
            recordCpuReviewFallback("stale-source");
          } else if (signed) {
            const plans = await loadPlansForOrders(sourceOrders.map(order => order.productionOrderId));
            const planByOrder = new Map(plans.map(plan => [plan.orderId, plan]));
            const currentAuthority = currentOrders.every(order => {
              const plan = planByOrder.get(order.canonicalId);
              const release = plan?.currentAllergenRelease;
              return Boolean(plan && release?.status === "current" && release.materializationStatus === "ready" && currentAllergenReleaseMatchesOrder(release, order, plan.menuItems));
            });
            if (!currentAuthority) {
              recordCpuReviewFallback("stale-release");
            } else {
              const entries: Record<string, { allergens: Record<string, ReviewState>; mayContainNotes?: string }> = {};
              for (const order of sourceOrders) for (const item of order.entries) {
                const key = item.sourceBookingLineId || item.sourceLineId;
                entries[key] = { allergens: Object.fromEntries(Object.entries(item.allergens).filter(([, value]) => value !== "unrecorded")) as Record<string, ReviewState>, ...(item.mayContainNotes ? { mayContainNotes: item.mayContainNotes } : {}) };
              }
              const artifact = sourceOrders.find(order => order.matrixArtifact)?.matrixArtifact;
              const sitePdfUrl = driveBlocked ? undefined : artifact?.driveUrl || artifact?.localUrl;
              return NextResponse.json({ status: "signed", signatures: signatureList, ...(sitePdfUrl ? { drivePdfUrl: sitePdfUrl } : {}), entries, package: packaged.manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
            }
          } else {
            return NextResponse.json({ status: "pending", signatures: signatureList, entries: {}, package: packaged.manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
          }
        }
        recordCpuReviewFallback("missing");
      } catch {
        recordCpuReviewFallback("invalid");
      }
    } else recordCpuReviewFallback("explicit-reconciliation");
    const orders = (await productionQueue(request, serviceDate)).filter(order => order.origin === "menu_planning" && order.destinationOplocId === oplocId && order.status !== "cancelled" && !order.supersededBy);
    const planRecords = await loadPlansForOrders(orders.map(order => order.canonicalId));
    const plans = new Map(planRecords.map(plan => [plan.orderId, plan as ReviewPlan]));
    const signatures = new Map<string, ReviewSignature>();
    for (const plan of plans.values()) for (const signature of plan.signatures || []) signatures.set(signature.role, signature);
    const signatureList = [...signatures.values()];
    const signed = orders.length > 0 && orders.every(order => {
      const plan = plans.get(order.canonicalId);
      const release = plan?.currentAllergenRelease;
      return Boolean(plan && release?.status === "current" && release.materializationStatus === "ready" && currentAllergenReleaseMatchesOrder(release, order, plan.menuItems));
    });
    const entries: Record<string, { allergens: Record<string, ReviewState>; mayContainNotes?: string }> = {};
    if (signed) for (const order of orders) {
      if (order.destinationOplocId !== oplocId) continue;
      const plan = plans.get(order.canonicalId);
      for (const item of plan?.menuItems || []) {
        const sub = item.subItems?.[0];
        const line = order.lines.find(candidate => candidate.canonicalId === item.sourceLineId);
        const projectionLineId = line?.sourceBookingLineId || item.sourceLineId;
        if (projectionLineId && sub) entries[projectionLineId] = { allergens: Object.keys(sub.allergens || {}).length ? sub.allergens! : (line?.approvedAllergenSnapshot?.allergens || {}) as Record<string, ReviewState>, mayContainNotes: sub.mayContainNotes || line?.approvedAllergenSnapshot?.mayContainNotes };
      }
    }
    if (request.nextUrl.searchParams.get("download") === "pdf") {
      if (!signed) return NextResponse.json({ error: { message: "The site matrix is unavailable until CPU sign-off is complete." } }, { status: 409 });
      return await sitePdf(request, serviceDate, oplocId, orders, plans, signatureList);
    }
    const sitePdfUrl = signed && !driveBlocked ? `${request.nextUrl.pathname}?serviceDate=${encodeURIComponent(serviceDate)}&oplocId=${encodeURIComponent(oplocId)}&download=pdf` : undefined;
    await rebuildCpuReviewPackage(request, serviceDate, oplocId);
    return NextResponse.json({ status: signed ? "signed" : "pending", signatures: signatureList, ...(sitePdfUrl ? { drivePdfUrl: sitePdfUrl } : {}), entries }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The CPU Delivered-In review could not be loaded." } }, { status: 502 });
  }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.delivered-in-review.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
