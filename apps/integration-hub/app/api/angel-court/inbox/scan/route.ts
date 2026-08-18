import { NextResponse } from "next/server";
import { assertLocalSafety } from "@/lib/safety";
import { getAngelCourtGmailScanState, runAngelCourtGmailScan } from "@/lib/angel-court-gmail-runner";

export async function GET() {
  try { assertLocalSafety(); return NextResponse.json({ state: await getAngelCourtGmailScanState() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read scan state." }, { status: 400 }); }
}

export async function POST() {
  try { assertLocalSafety(); return NextResponse.json({ result: await runAngelCourtGmailScan({ force: true }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Angel Court Gmail scan failed." }, { status: 400 }); }
}
