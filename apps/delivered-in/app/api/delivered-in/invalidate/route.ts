import { NextRequest, NextResponse } from "next/server";
import { invalidateDeliveredInProjection } from "@/lib/delivered-in-invalidation";
import { isValidDeliveredInInvalidation } from "@/lib/delivered-in-invalidation-input";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { deliveredInErrorBody } from "@/lib/server";

export const dynamic = "force-dynamic";

function internalAllowed(request: NextRequest) {
  const configured = process.env.DELIVERED_IN_INTERNAL_API_TOKEN || process.env.FIKA_INTERNAL_API_TOKEN;
  return Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}
async function handlePost(request: NextRequest) {
  try {
    if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal authentication is required." } }, { status: 401 });
    const body = await request.json().catch(() => undefined);
    if (!isValidDeliveredInInvalidation(body)) return NextResponse.json({ error: { message: "A bounded invalidation scope and source identity are required." } }, { status: 422 });
    return NextResponse.json(await invalidateDeliveredInProjection(request, body, { reconciliationContext: { mode: "internal", oplocId: body.oplocId, serviceDate: body.serviceDate } }));
  } catch (error) {
    return NextResponse.json(deliveredInErrorBody(error, "Delivered-In invalidation failed."), { status: Number((error as { status?: number }).status) || 502 });
  }
}
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.projection.invalidate", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
