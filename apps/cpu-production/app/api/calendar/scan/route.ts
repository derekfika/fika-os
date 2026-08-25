import { NextResponse } from "next/server";
import { errorResponse } from "@hub/lib/api";
import { getCpuCalendarScanState, runCpuCalendarScan } from "@hub/lib/cpu-calendar-runner";

export async function GET() {
  try { return NextResponse.json(await getCpuCalendarScanState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST() {
  try { return NextResponse.json({ result: await runCpuCalendarScan({ force: true }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
