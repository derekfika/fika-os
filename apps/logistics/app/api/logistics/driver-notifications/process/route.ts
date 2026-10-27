import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../../shared/internal-auth";
import { countOpenCaptureGaps, processDriverNotifications } from "@/lib/driver-notification-store";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Server-owned recovery for driver change events whose post-save processing was interrupted. Invoked by a scheduler with the
 * internal token (see docs/deployment); vehicle sessions can never reach it. Bounded, idempotent and safe to overlap, and it
 * returns counts only: no notification content leaves the server.
 */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403, headers: NO_STORE });
  try {
    const result = await processDriverNotifications(new Date(), 50);
    // openCaptureGaps > 0 means a committed planner change may not have notified drivers (see the coverage doc); it is health output.
    const openCaptureGaps = await countOpenCaptureGaps().catch(() => -1);
    return NextResponse.json({ ...result, openCaptureGaps }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: { message: "Driver notification processing is deferred for retry." } }, { status: 503, headers: NO_STORE });
  }
}
