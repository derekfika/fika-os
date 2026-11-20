import { NextRequest, NextResponse } from "next/server";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { actorCanAccessOploc, resolveMenuActor } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveMenuActor(request);
    const oplocs = (await readDeliveredInOplocs(request)).filter(oploc => actorCanAccessOploc(actor, oploc.canonicalId));
    return NextResponse.json({ oplocs: oplocs.sort((a, b) => a.label.localeCompare(b.label)) }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "OPLOC authority is unavailable." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
