import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { scanCpuXCalendarBackfill, enqueueCpuXCalendarOrder } from "../../../../lib/cpux-calendar-publisher";
import { productionQueue } from "../../../../lib/production-http-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPUX Calendar backfill access is not authorised." } }, { status: 401 });
  const body = await request.json().catch(() => undefined) as { fromServiceDate?: unknown; toServiceDate?: unknown } | undefined;
  if (typeof body?.fromServiceDate !== "string" || typeof body.toServiceDate !== "string") {
    return NextResponse.json({ error: { message: "Explicit fromServiceDate and toServiceDate values are required." } }, { status: 422 });
  }
  try {
    const result = await scanCpuXCalendarBackfill(
      body.fromServiceDate,
      body.toServiceDate,
      serviceDate => productionQueue(request, serviceDate),
      enqueueCpuXCalendarOrder,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPUX Calendar backfill scan failed." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
