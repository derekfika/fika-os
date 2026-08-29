import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { buildGrabAndGoProduction, readGrabAndGoSource, relevantGrabAndGoDates, type GrabAndGoSourceOrder } from "../../../lib/grab-and-go-read";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const source = await readGrabAndGoSource(); const orders = source.orders as GrabAndGoSourceOrder[]; const dates = relevantGrabAndGoDates(orders); const today = new Date().toISOString().slice(0, 10); const requested = request.nextUrl.searchParams.get("deliveryDate"); const deliveryDate = requested && dates.includes(requested) ? requested : dates.find(date => date >= today) || dates.at(-1) || today;
    return NextResponse.json({ deliveryDate, dates, production: buildGrabAndGoProduction(deliveryDate, orders, source.catalogue || []) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}
