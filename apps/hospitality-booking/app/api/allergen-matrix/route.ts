import { NextRequest, NextResponse } from "next/server";

function cpuBase() { return (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, ""); }

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const productionOrderId = request.nextUrl.searchParams.get("productionOrderId");
  if (!bookingId) return NextResponse.json({ error: { message: "A Booking is required." } }, { status: 400 });
  try {
    const candidates = [...new Set([productionOrderId, bookingId, `production-order:v1:${bookingId}`, `production-order:${bookingId}`].filter(Boolean))] as string[];
    const viewUrlFor = (candidate: string) => `/api/allergen-matrix?bookingId=${encodeURIComponent(bookingId)}&productionOrderId=${encodeURIComponent(candidate)}&view=1`;
    if (request.nextUrl.searchParams.get("view") === "1") {
      for (const candidate of candidates) {
        const response = await fetch(`${cpuBase()}/api/production-plan?orderId=${encodeURIComponent(candidate)}&download=html`, { cache: "no-store" });
        if (response.ok) {
          return new NextResponse(await response.text(), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": "inline; filename=\"signed-allergen-matrix.html\"" } });
        }
      }
      return NextResponse.json({ error: { message: "The fully signed CPU allergen matrix is not available." } }, { status: 404 });
    }
    let notConfigured = false;
    for (const candidate of candidates) {
      const response = await fetch(`${cpuBase()}/api/production-plan?orderId=${encodeURIComponent(candidate)}`, { cache: "no-store" });
      const body = await response.json() as { plan?: { matrixArtifact?: Record<string, unknown> }; matrixStatus?: "generating" | "ready" | "not_configured"; signedMatrixAvailable?: boolean; error?: { message?: string } };
      if (response.ok && body.plan?.matrixArtifact) return NextResponse.json({ artifact: { ...body.plan.matrixArtifact, viewUrl: viewUrlFor(candidate) } });
      if (response.ok && body.signedMatrixAvailable) return NextResponse.json({ artifact: { fileName: "signed-allergen-matrix.html", driveStatus: "not_configured", viewUrl: viewUrlFor(candidate) } });
      if (response.ok && body.matrixStatus === "generating") return NextResponse.json({ artifact: null, status: "generating" });
      if (response.ok && body.matrixStatus === "not_configured") notConfigured = true;
    }
    return NextResponse.json({ artifact: null, ...(notConfigured ? { status: "not_configured" } : {}) });
  } catch (error) {
    return NextResponse.json({ error: { message: `CPU Production is unavailable: ${(error as Error).message}` } }, { status: 502 });
  }
}
