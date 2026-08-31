import { NextRequest, NextResponse } from "next/server";
import { invalidateLogisticsProjection } from "@/lib/store";
import type { LogisticsProjectionInvalidation } from "@/lib/logistics-projection";

function internalAllowed(request: NextRequest) {
  const configured = process.env.FIKA_INTERNAL_API_TOKEN;
  return process.env.NODE_ENV !== "production" && !configured || Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}

export async function POST(request: NextRequest) {
  if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json() as Partial<LogisticsProjectionInvalidation>;
  if (!body.serviceDate || !body.sourceDomain || !body.sourceEntityId || !Number.isInteger(body.sourceVersion) || !body.changedAt || !body.changeType) return NextResponse.json({ error: { message: "A complete Logistics projection invalidation is required." } }, { status: 422 });
  return NextResponse.json(await invalidateLogisticsProjection(body as LogisticsProjectionInvalidation));
}
