import { NextRequest, NextResponse } from "next/server";
import { cpuCalendarScanState, runCpuCalendarScan } from "../../../../lib/production-http-client";

function errorResponse(error: unknown) {
  const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503;
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Calendar scan unavailable." } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  try { return NextResponse.json(await cpuCalendarScanState(request), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { return NextResponse.json(await runCpuCalendarScan(request), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
