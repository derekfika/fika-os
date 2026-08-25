import { NextRequest, NextResponse } from "next/server";
import { productionQueue } from "@hub/lib/production-domain";
import { cpuPlans } from "../../../../lib/cpu-projection";
import { promises as fs } from "node:fs";
import path from "node:path";
import { allergenMatrixHtml } from "../../../ui/allergen-matrix";
import { renderPdfLocally } from "../../../lib/local-pdf";

export const dynamic = "force-dynamic";

type ReviewState = "clear" | "contains" | "may_contain";
type ReviewSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor?: string; attestation?: string; signatureDataUrl?: string };
type ReviewPlan = { orderId: string; signatures?: ReviewSignature[]; menuItems?: Array<{ id: string; sourceLineId?: string; name: string; note: string; subItems?: Array<{ id: string; name: string; quantity: number | null; allergens?: Record<string, ReviewState>; mayContainNotes?: string; note: string; evidenceStatus: "not_completed" | "completed" | "requires_review" }> }> };

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
  const base = path.join(process.cwd(), "local-data", "cpu-production", "matrices", "delivered-in");
  const fileName = `${serviceDate}_${(sourceOrder.destinationLabel || oplocId).replace(/[^A-Za-z0-9._-]+/g, "_")}_Delivered-In_Allergen-Matrix.pdf`;
  const pdfPath = path.join(base, fileName);
  await renderPdfLocally(html, pdfPath);
  return new NextResponse(await fs.readFile(pdfPath), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  const serviceDate = request.nextUrl.searchParams.get("serviceDate");
  const oplocId = request.nextUrl.searchParams.get("oplocId");
  if (!serviceDate || !oplocId) return NextResponse.json({ error: { message: "A service date and OPLOC are required." } }, { status: 422 });
  try {
    const orders = (await productionQueue(serviceDate)).filter(order => order.origin === "menu_planning");
    const planSnapshot = await cpuPlans().get();
    const plans = new Map(planSnapshot.docs.map(document => [document.id, document.data() as ReviewPlan]));
    const signatures = new Map<string, ReviewSignature>();
    for (const plan of plans.values()) for (const signature of plan.signatures || []) signatures.set(signature.role, signature);
    const signatureList = [...signatures.values()];
    const signed = signatureList.some(signature => signature.role === "production_chef") && signatureList.some(signature => signature.role === "head_chef_site_manager");
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
    const sitePdfUrl = signed ? `${request.nextUrl.pathname}?serviceDate=${encodeURIComponent(serviceDate)}&oplocId=${encodeURIComponent(oplocId)}&download=pdf` : undefined;
    return NextResponse.json({ status: signed ? "signed" : "pending", signatures: signatureList, ...(sitePdfUrl ? { drivePdfUrl: sitePdfUrl } : {}), entries }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The CPU Delivered-In review could not be loaded." } }, { status: 502 });
  }
}
