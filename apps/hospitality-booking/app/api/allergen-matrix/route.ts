import { NextRequest, NextResponse } from "next/server";

function cpuBase() { return (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, ""); }

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const productionOrderId = request.nextUrl.searchParams.get("productionOrderId");
  if (!bookingId) return NextResponse.json({ error: { message: "A Booking is required." } }, { status: 400 });
  try {
    const candidates = [...new Set([productionOrderId, bookingId, `production-order:v1:${bookingId}`, `production-order:${bookingId}`].filter(Boolean))] as string[];
    for (const candidate of candidates) {
      const response = await fetch(`${cpuBase()}/api/production-plan?orderId=${encodeURIComponent(candidate)}`, { cache: "no-store" });
      const body = await response.json() as { plan?: { matrixArtifact?: unknown }; matrixStatus?: "generating" | "ready"; error?: { message?: string } };
      if (response.ok && body.plan?.matrixArtifact) return NextResponse.json({ artifact: body.plan.matrixArtifact });
      if (response.ok && body.matrixStatus === "generating") return NextResponse.json({ artifact: null, status: "generating" });
    }
    return NextResponse.json({ artifact: null });
  } catch (error) {
    return NextResponse.json({ error: { message: `CPU Production is unavailable: ${(error as Error).message}` } }, { status: 502 });
  }
}
