import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { applyFulfilmentEvent } from "@/lib/fulfilment-projection";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit");
    const body = await request.json() as { events?: unknown[] };
    const events = Array.isArray(body.events) ? body.events : [];
    const results = [];
    for (const event of events) results.push(await applyFulfilmentEvent(event as never));
    return NextResponse.json({ results });
  } catch (error) { return errorResponse(error); }
}
