import { NextResponse } from "next/server";
import { getCpuCalendarScanState, runCpuCalendarScan } from "@hub/lib/cpu-calendar-runner";

export async function GET() {
  try { return NextResponse.json(await getCpuCalendarScanState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CPU calendar scan unavailable." }, { status: 400 }); }
}

export async function POST() {
  try { return NextResponse.json({ result: await runCpuCalendarScan({ force: true }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CPU calendar scan failed." }, { status: 400 }); }
}
