import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { z } from "zod";
import { getCpuCalendarScanState, runCpuCalendarScan } from "@/lib/cpu-calendar-runner";

const ScanCommand = z.object({ force: z.boolean().optional().default(true) }).strict();

export async function GET(request: NextRequest) {
  try { const actor = await requireActor(request); assertPermission(actor, "canonical.view"); return NextResponse.json(await getCpuCalendarScanState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); const command = ScanCommand.parse(await request.json()); return NextResponse.json({ result: await runCpuCalendarScan(command) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
