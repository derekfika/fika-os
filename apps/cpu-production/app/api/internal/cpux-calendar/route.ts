import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { applyCpuXCalendarOrder, claimCpuXCalendarOrder, finishCpuXCalendarOrder, releaseCpuXCalendarOrderClaim } from "../../../../lib/cpux-calendar-publisher";
import { productionOrderDetail } from "../../../../lib/production-http-client";

export const dynamic = "force-dynamic";

function payload(value: unknown): value is { canonicalId: string; sourceVersion: number } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.canonicalId === "string" && item.canonicalId.length > 0 && Number.isInteger(item.sourceVersion) && Number(item.sourceVersion) > 0;
}

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPUX Calendar access is not authorised." } }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  if (!payload(body)) return NextResponse.json({ error: { message: "A canonical Production Order identity and source version are required." } }, { status: 422 });
  const claim = await claimCpuXCalendarOrder(body.canonicalId, body.sourceVersion);
  if (claim.status === "superseded") return NextResponse.json({ applied: false, status: "superseded" });
  if (claim.status === "missing") return NextResponse.json({ error: { message: "No staged CPUX Calendar publication exists for this order." } }, { status: 409 });
  if (claim.status === "busy") return NextResponse.json({ error: { message: "Another CPUX Calendar delivery is active for this order." } }, { status: 503, headers: { "retry-after": "10" } });

  try {
    const order = await productionOrderDetail(request, body.canonicalId);
    if (!order || order.version !== body.sourceVersion) {
      await releaseCpuXCalendarOrderClaim(body.canonicalId, claim.claimId);
      return NextResponse.json({ error: { message: "The canonical Production Order changed before Calendar publication." } }, { status: 409 });
    }
    const result = await applyCpuXCalendarOrder(order);
    await finishCpuXCalendarOrder(body.canonicalId, claim.claimId, body.sourceVersion, result.operation);
    return NextResponse.json({ applied: result.applied, status: result.operation, eventId: result.eventId });
  } catch (error) {
    await releaseCpuXCalendarOrderClaim(body.canonicalId, claim.claimId);
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPUX Calendar publication failed." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
