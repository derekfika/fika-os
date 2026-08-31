import { NextRequest, NextResponse } from "next/server";
import { invalidateLogisticsProjection } from "@/lib/store";
import type { LogisticsProjectionInvalidation } from "@/lib/logistics-projection";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

function internalAllowed(request: NextRequest) {
  const configured = process.env.FIKA_INTERNAL_API_TOKEN;
  return process.env.NODE_ENV !== "production" && !configured || Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}

async function handlePost(request: NextRequest) {
  if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json() as Partial<LogisticsProjectionInvalidation>;
  const changeTypes = ["amended", "cancelled", "withdrawn", "superseded", "status-changed"] as const;
  if (!body.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate) || !body.sourceDomain || !body.sourceEntityId || typeof body.sourceVersion !== "number" || !Number.isInteger(body.sourceVersion) || body.sourceVersion < 1 || !body.changedAt || !body.changeType || !changeTypes.includes(body.changeType as typeof changeTypes[number])) return NextResponse.json({ error: { message: "A complete Logistics projection invalidation is required." } }, { status: 422 });
  return NextResponse.json(await invalidateLogisticsProjection(body as LogisticsProjectionInvalidation));
}

export async function POST(request: NextRequest) { return withDataTrace({ app: "logistics", action: "logistics.projection.invalidate", path: request.nextUrl.pathname }, () => handlePost(request)); }
