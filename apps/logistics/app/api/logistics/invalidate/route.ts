import { NextRequest, NextResponse } from "next/server";
import { invalidateLogisticsProjection } from "@/lib/store";
import { reconcileLogisticsDay } from "@/lib/logistics-materialisation";
import type { LogisticsProjectionInvalidation } from "@/lib/logistics-projection";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";

function internalAllowed(request: NextRequest) {
  // internalTokenAllowed validates the x-fika-internal-token header.
  return internalTokenAllowed(request);
}

async function handlePost(request: NextRequest) {
  if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json() as Partial<LogisticsProjectionInvalidation>;
  const changeTypes = ["amended", "cancelled", "withdrawn", "superseded", "status-changed"] as const;
  if (!body.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate) || !body.sourceDomain || !body.sourceEntityId || typeof body.sourceVersion !== "number" || !Number.isInteger(body.sourceVersion) || body.sourceVersion < 1 || !body.changedAt || !body.changeType || !changeTypes.includes(body.changeType as typeof changeTypes[number])) return NextResponse.json({ error: { message: "A complete Logistics projection invalidation is required." } }, { status: 422 });
  const result = await invalidateLogisticsProjection(body as LogisticsProjectionInvalidation);
  if (result.reason === "missing-projection") {
    const materialised = await reconcileLogisticsDay(
      body.serviceDate,
      `source:${body.sourceDomain}`,
      `source:${body.sourceDomain}`,
      request.headers.get("cookie") || undefined,
      body as LogisticsProjectionInvalidation,
    );
    return NextResponse.json({ ...result, materialised: true, ...materialised });
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) { return withDataTrace({ app: "logistics", action: "logistics.projection.invalidate", path: request.nextUrl.pathname }, () => handlePost(request)); }
