import { NextResponse } from "next/server";
import { assertLocalSafety } from "@/lib/safety";
import { getCpuCalendarScanState, runCpuCalendarScan } from "@/lib/cpu-calendar-runner";

export async function GET() {
  try { assertLocalSafety(); return NextResponse.json(await getCpuCalendarScanState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CPU calendar scan unavailable." }, { status: 400 }); }
}

export async function POST() {
  try { assertLocalSafety(); return NextResponse.json({ result: await runCpuCalendarScan({ force: true }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CPU calendar scan failed." }, { status: 400 }); }
}
