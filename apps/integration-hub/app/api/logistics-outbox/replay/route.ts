import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { errorResponse } from "@/lib/api";
import { deliverLogisticsProjection, getLogisticsProjectionOutboxEvent, resetLogisticsProjectionDeadLetter, type LogisticsProjectionOutboxEvent } from "@/lib/logistics-projection-outbox";

const EventId = z.string().min(1).max(2000).regex(/^[^/\x00-\x1f]+$/);
const Command = z.object({ eventId: EventId, commandId: z.string().uuid(), reason: z.string().trim().min(5).max(500), expectedAttempts: z.number().int().nonnegative(), expectedDeadLetteredAt: z.string().datetime() }).strict();
function summary(event: LogisticsProjectionOutboxEvent) {
  return { eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, sourceVersion: event.sourceVersion, serviceDate: event.payload.serviceDate, delivery: event.delivery };
}
async function requireRecoveryActor(request: NextRequest) {
  const actor = await requireActor(request, ["integration-admin"]);
  assertPermission(actor, "canonical.edit");
  return actor;
}
export async function GET(request: NextRequest) {
  try {
    await requireRecoveryActor(request);
    const event = await getLogisticsProjectionOutboxEvent(EventId.parse(request.nextUrl.searchParams.get("eventId")));
    if (!event) throw Object.assign(new Error("Logistics update not found."), { status: 404 });
    return NextResponse.json({ event: summary(event) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireRecoveryActor(request);
    const command = Command.parse(await request.json());
    const result = await resetLogisticsProjectionDeadLetter({ ...command, actorId: actor.uid });
    // The reset survives a process/network failure. Normal bounded worker claims it.
    const delivered = await deliverLogisticsProjection(command.eventId);
    return NextResponse.json({ changed: result.changed, auditId: result.auditId, event: summary(delivered || result.event) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
