import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { applyFulfilmentEvent, listFulfilmentRequirements, listFulfilmentReceipts } from "@/lib/fulfilment-projection";
import { internalTokenAllowed } from "../../../../shared/internal-auth";

function internalAllowed(request: NextRequest) {
  return internalTokenAllowed(request);
}

export async function GET(request: NextRequest) {
  try {
    if (!internalAllowed(request)) { const actor = await requireActor(request); assertPermission(actor, "canonical.view"); }
    const query = request.nextUrl.searchParams;
    const requirements = await listFulfilmentRequirements({ serviceDate: query.get("serviceDate") || undefined, serviceDateFrom: query.get("serviceDateFrom") || undefined, serviceDateToExclusive: query.get("serviceDateToExclusive") || undefined, status: (query.get("status") as never) || undefined, destinationOplocId: query.get("destinationOplocId") || undefined, productionLocationId: query.get("productionLocationId") || undefined });
    return NextResponse.json({ requirements }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!internalAllowed(request)) { const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); }
    const event = await request.json();
    const result = await applyFulfilmentEvent(event);
    return NextResponse.json(result, { status: result.error ? 422 : result.duplicate ? 200 : 202 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.view");
    return NextResponse.json({ receipts: await listFulfilmentReceipts(Number(request.nextUrl.searchParams.get("limit") || 500)) });
  } catch (error) { return errorResponse(error); }
}
