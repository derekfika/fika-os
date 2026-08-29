import { NextRequest, NextResponse } from "next/server";
import { saveGoogleDrivePdf } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";

/** Server-side Drive adapter used by CPU Production. Ownership is selected
 * from the canonical Production Order context supplied by the CPU server. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; html?: string; pdfBase64?: string; weekCommencing?: string; productionOrderId?: string };
    if (!body.name?.trim() || !body.html?.trim()) return NextResponse.json({ error: { message: "A matrix file name and document are required." } }, { status: 400 });
    if (!body.pdfBase64?.trim()) return NextResponse.json({ error: { message: "The allergen matrix PDF could not be generated; an HTML file will not be uploaded as a matrix." } }, { status: 422 });
    if (!body.productionOrderId?.trim()) return NextResponse.json({ error: { message: "A canonical Production Order is required to select the Drive workspace." } }, { status: 422 });
    try {
      const orderResponse = await hubUserFetch(`/api/production?canonicalId=${encodeURIComponent(body.productionOrderId.trim())}`, request.headers.get("cookie"), { headers: { accept: "application/json", ...(request.headers.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) } });
      const orderBody = await orderResponse.json() as { order?: { origin?: string; destinationOplocId?: string } };
      if (!orderResponse.ok || !orderBody.order) return NextResponse.json({ error: { message: "The canonical Production Order could not be loaded for Drive workspace selection." } }, { status: orderResponse.status || 502 });
      const isHospitality = orderBody.order.origin === "hospitality_booking";
      if (isHospitality && !orderBody.order.destinationOplocId?.trim()) return NextResponse.json({ error: { message: "The hospitality Production Order has no canonical OPLOC for its Drive workspace." } }, { status: 422 });
      const owner = isHospitality ? { type: "oploc-workspace" as const, oplocId: orderBody.order.destinationOplocId!.trim() } : { type: "app-workspace" as const, appId: "cpu-production" as const };
      const saved = await saveGoogleDrivePdf({ name: body.name.trim(), pdfBase64: body.pdfBase64, owner, folderId: isHospitality ? undefined : process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID, weekCommencing: body.weekCommencing, folderLabel: isHospitality ? "Hospitality allergen matrix" : "CPU production" });
      return saved ? NextResponse.json({ saved }) : NextResponse.json({ saved: null, configured: false }, { status: 503 });
    } catch (error) {
      if (/not configured|folder|OAuth|token/i.test((error as Error).message)) return NextResponse.json({ saved: null, configured: false }, { status: 503 });
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 502 });
  }
}
