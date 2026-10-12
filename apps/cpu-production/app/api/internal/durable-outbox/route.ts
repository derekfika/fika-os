import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { reconcileCpuProjectionsIfDue, reconcileCpuWeek, reconciliationMode } from "../../../../lib/cpu-projection-reconciliation";
import { deliverCpuPropagation, recoverCpuPropagation, replayCpuPropagation } from "../../../../lib/cpu-durable-outbox";

export const dynamic = "force-dynamic";

/** Bounded operator/worker endpoint. It never scans or drains the full outbox. */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPU outbox access is not authorised." } }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; eventId?: string; limit?: number; weeks?: string[]; dryRun?: boolean };
    if (body.action === "reconcile") {
      const weeks = (body.weeks || []).filter(week => /^\d{4}-\d{2}-\d{2}$/.test(week)).slice(0, 20);
      if (!weeks.length) return NextResponse.json(await reconcileCpuProjectionsIfDue(request));
      const mode = body.dryRun ? "report" as const : reconciliationMode() === "off" ? "report" as const : reconciliationMode();
      const outcomes = []; for (const week of weeks) outcomes.push(await reconcileCpuWeek(request, week, { mode }));
      return NextResponse.json({ mode, checked: outcomes.length, outcomes });
    }
    if (body.action === "replay") {
      if (!body.eventId) return NextResponse.json({ error: { message: "eventId is required for replay." } }, { status: 400 });
      const event = await replayCpuPropagation(body.eventId);
      return event ? NextResponse.json({ replayed: true, event }) : NextResponse.json({ replayed: false }, { status: 404 });
    }
    if (body.eventId) return NextResponse.json(await deliverCpuPropagation(body.eventId));
    const recovered = await recoverCpuPropagation(body.limit);
    const reconciliation = await reconcileCpuProjectionsIfDue(request).catch(error => ({ error: error instanceof Error ? error.message : "reconciliation failed" }));
    return NextResponse.json({ recovered, reconciliation });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU outbox recovery failed." } }, { status: 500 });
  }
}
