import { NextRequest, NextResponse } from "next/server";
import { listGrabAndGoOrdersForProductionHosted, readGrabAndGoCatalogue } from "@/lib/grab-and-go-store";

export const dynamic = "force-dynamic";

function assertCpuBoundary(request: NextRequest) {
  const expected = process.env.DELIVERED_IN_INTERNAL_API_TOKEN;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) throw Object.assign(new Error("The CPU production integration is not authorised."), { status: 401 });
}

export async function GET(request: NextRequest) {
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
