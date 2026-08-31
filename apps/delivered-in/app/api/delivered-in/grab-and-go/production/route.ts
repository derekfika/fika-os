import { NextRequest, NextResponse } from "next/server";
import { listGrabAndGoOrdersForProductionHosted, readGrabAndGoCatalogue } from "@/lib/grab-and-go-store";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

function assertCpuBoundary(request: NextRequest) {
  const expected = process.env.FIKA_INTERNAL_API_TOKEN;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}` && request.headers.get("x-fika-internal-token") !== expected) throw Object.assign(new Error("The CPU production integration is not authorised."), { status: 401 });
}

async function handleGet(request: NextRequest) {
  try {
    assertCpuBoundary(request);
    const deliveryDate = request.nextUrl.searchParams.get("deliveryDate") || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const end = new Date(`${deliveryDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + (request.nextUrl.searchParams.has("deliveryDate") ? 1 : 43));
    const orders = (await listGrabAndGoOrdersForProductionHosted(deliveryDate, end.toISOString().slice(0, 10))).filter(order => order.status === "submitted");
    return NextResponse.json({ orders, catalogue: readGrabAndGoCatalogue() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Grab & Go production data is unavailable." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.production.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
