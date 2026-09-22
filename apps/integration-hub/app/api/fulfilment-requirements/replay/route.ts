import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { applyFulfilmentEvent } from "@/lib/fulfilment-projection";
import { deliverLogisticsProjectionForRequirement } from "@/lib/logistics-projection-outbox";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit");
    const body = await request.json() as { events?: unknown[] };
    const events = Array.isArray(body.events) ? body.events : [];
    const results = [];
    for (const event of events) {
      const result = await applyFulfilmentEvent(event as never);
      const logisticsHandoff = result.requirement ? await deliverLogisticsProjectionForRequirement(result.requirement) : undefined;
      results.push({ ...result, ...(logisticsHandoff ? { logisticsHandoff: logisticsHandoff.delivery.status } : {}) });
    }
    return NextResponse.json({ results });
  } catch (error) { return errorResponse(error); }
}
