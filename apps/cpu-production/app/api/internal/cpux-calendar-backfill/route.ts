import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { scanCpuXCalendarBackfill, enqueueCpuXCalendarOrder, cpuXCalendarBackfillEnabled, previewCpuXCalendarBackfill } from "../../../../lib/cpux-calendar-publisher";
import { productionQueue } from "../../../../lib/production-http-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPUX Calendar backfill access is not authorised." } }, { status: 401 });
  const body = await request.json().catch(() => undefined) as { fromServiceDate?: unknown; toServiceDate?: unknown; mode?: unknown } | undefined;
  if (typeof body?.fromServiceDate !== "string" || typeof body.toServiceDate !== "string") {
    return NextResponse.json({ error: { message: "Explicit fromServiceDate and toServiceDate values are required." } }, { status: 422 });
  }
  if (body.mode !== undefined && body.mode !== "preview" && body.mode !== "execute") {
    return NextResponse.json({ error: { message: "mode must be preview or execute." } }, { status: 422 });
  }
  const listOrders = (serviceDate: string) => productionQueue(request, serviceDate);
  if (body.mode !== "execute") {
    try {
      return NextResponse.json({ mode: "preview", ...(await previewCpuXCalendarBackfill(body.fromServiceDate, body.toServiceDate, listOrders)) });
    } catch (error) {
      return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPUX Calendar backfill preview failed." } }, { status: Number((error as { status?: number }).status) || 502 });
    }
  }
  if (!cpuXCalendarBackfillEnabled()) return NextResponse.json({ error: { message: "CPUX Calendar backfill is disabled outside the separately enabled production workflow." } }, { status: 503 });
  try {
    const result = await scanCpuXCalendarBackfill(
      body.fromServiceDate,
      body.toServiceDate,
      listOrders,
      enqueueCpuXCalendarOrder,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPUX Calendar backfill scan failed." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
