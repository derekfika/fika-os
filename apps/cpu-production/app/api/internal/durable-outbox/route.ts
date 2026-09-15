import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { deliverCpuPropagation, recoverCpuPropagation, replayCpuPropagation } from "../../../../lib/cpu-durable-outbox";

export const dynamic = "force-dynamic";

/** Bounded operator/worker endpoint. It never scans or drains the full outbox. */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPU outbox access is not authorised." } }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; eventId?: string; limit?: number };
    if (body.action === "replay") {
      if (!body.eventId) return NextResponse.json({ error: { message: "eventId is required for replay." } }, { status: 400 });
      const event = await replayCpuPropagation(body.eventId);
      return event ? NextResponse.json({ replayed: true, event }) : NextResponse.json({ replayed: false }, { status: 404 });
    }
    if (body.eventId) return NextResponse.json(await deliverCpuPropagation(body.eventId));
    return NextResponse.json({ recovered: await recoverCpuPropagation(body.limit) });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU outbox recovery failed." } }, { status: 500 });
  }
}
