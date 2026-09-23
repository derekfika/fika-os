import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { reconcileProductionFulfilmentForServiceDate } from "@/lib/fulfilment-projection";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { serviceDate?: unknown; limit?: unknown };
  const serviceDate = typeof body.serviceDate === "string" ? body.serviceDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return NextResponse.json({ error: { message: "A valid serviceDate is required." } }, { status: 422 });
  try {
    return NextResponse.json(await reconcileProductionFulfilmentForServiceDate(serviceDate, typeof body.limit === "number" ? body.limit : undefined), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const message = error instanceof Error ? error.message.slice(0, 500) : "Production Fulfilment reconciliation failed.";
    return NextResponse.json({ error: { message, requestId } }, { status: 502, headers: { "x-request-id": requestId } });
  }
}
