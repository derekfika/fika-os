import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";
import { recoverGrabHandoffs } from "../../../../lib/grab-and-go-handoff";
import { HANDOFF_SCHEDULER_AUDIENCE, schedulerRequestAllowed } from "../../../../lib/scheduler-auth";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const internal = internalTokenAllowed(request);
  let scheduler = false;
  if (!internal) { try { scheduler = await schedulerRequestAllowed(request, getFikaRuntimeConfig(), HANDOFF_SCHEDULER_AUDIENCE); } catch { scheduler = false; } }
  if (!internal && !scheduler) return NextResponse.json({ error: { message: "Internal recovery authority required." } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as { limit?: number };
    if (Object.keys(body).some(key => key !== "limit")) return NextResponse.json({ error: { message: "Only bounded recovery is supported." } }, { status: 422 });
    return NextResponse.json(await recoverGrabHandoffs(body.limit));
  } catch (error) { return NextResponse.json({ error: { message: "Grab & Go recovery failed." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
