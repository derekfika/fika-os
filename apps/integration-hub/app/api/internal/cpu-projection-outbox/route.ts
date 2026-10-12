import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { deliverCpuProjection, replayCpuProjectionOutbox, resetCpuProjectionDeadLetter, summariseCpuProjectionOutbox } from "@/lib/cpu-projection-outbox";

export const dynamic = "force-dynamic";

/** Internal operations for the durable Hub -> CPU projection handoff: replay, single delivery, visibility and reviewed dead-letter reset. */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { eventId?: string; limit?: number; summary?: boolean; resetDeadLetter?: { eventId?: string; reason?: string } };
  try {
    if (body.summary) return NextResponse.json(await summariseCpuProjectionOutbox());
    if (body.resetDeadLetter) {
      const { eventId, reason } = body.resetDeadLetter;
      if (!eventId || !reason?.trim()) return NextResponse.json({ error: { message: "eventId and a reason are required." } }, { status: 422 });
      const event = await resetCpuProjectionDeadLetter({ eventId, reason: reason.trim(), actorId: "internal-operator" });
      return NextResponse.json({ reset: true, eventId: event.eventId, delivery: event.delivery });
    }
    if (body.eventId) {
      const event = await deliverCpuProjection(body.eventId);
      return event ? NextResponse.json({ attempted: 1, eventId: event.eventId, status: event.delivery.status, attempts: event.delivery.attempts }) : NextResponse.json({ attempted: 0 }, { status: 404 });
    }
    return NextResponse.json(await replayCpuProjectionOutbox(body.limit));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU projection outbox operation failed." } }, { status: Number((error as { status?: number }).status) || 500 });
  }
}
