import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { deliverLogisticsProjection, repairLogisticsProjectionForServiceDate, replayLogisticsProjectionOutbox } from "@/lib/logistics-projection-outbox";

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { eventId?: string; limit?: number; serviceDate?: string };
  if (body.eventId) {
    const event = await deliverLogisticsProjection(body.eventId);
    return event ? NextResponse.json({ attempted: 1, event }) : NextResponse.json({ attempted: 0 }, { status: 404 });
  }
  if (body.serviceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate)) return NextResponse.json({ error: { message: "A valid serviceDate is required." } }, { status: 422 });
    return NextResponse.json(await repairLogisticsProjectionForServiceDate(body.serviceDate, body.limit));
  }
  return NextResponse.json(await replayLogisticsProjectionOutbox(body.limit));
}
