import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { applyCpuXCalendarOrder, claimCpuXCalendarOrder, cpuXCalendarOrderIdentity, cpuXCalendarWritesEnabled, finishCpuXCalendarOrder, releaseCpuXCalendarOrderClaim } from "../../../../lib/cpux-calendar-publisher";
import { hubJson, productionOrderDetail } from "../../../../lib/production-http-client";
import type { ProductionOrder } from "../../../../lib/production-types";

export const dynamic = "force-dynamic";

function payload(value: unknown): value is { canonicalId: string; sourceVersion: number } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.canonicalId === "string" && item.canonicalId.length > 0 && Number.isInteger(item.sourceVersion) && Number(item.sourceVersion) > 0;
}

export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPUX Calendar access is not authorised." } }, { status: 401 });
  if (!cpuXCalendarWritesEnabled()) return NextResponse.json({ error: { message: "CPUX Calendar writes are disabled outside the explicitly enabled production runtime." } }, { status: 503 });
  const body = await request.json().catch(() => undefined);
  if (!payload(body)) return NextResponse.json({ error: { message: "A canonical Production Order identity and source version are required." } }, { status: 422 });
  let order: ProductionOrder;
  let calendarIdentity: string;
  try {
    order = await productionOrderDetail(request, body.canonicalId);
    if (!order || order.version !== body.sourceVersion) return NextResponse.json({ error: { message: "The canonical Production Order changed before Calendar publication." } }, { status: 409 });
    calendarIdentity = cpuXCalendarOrderIdentity(order).canonicalId;
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Canonical Calendar lineage could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
  const claim = await claimCpuXCalendarOrder(body.canonicalId, body.sourceVersion, new Date(), process.env, calendarIdentity);
  if (claim.status === "superseded") return NextResponse.json({ applied: false, status: "superseded" });
  if (claim.status === "missing") return NextResponse.json({ error: { message: "No staged CPUX Calendar publication exists for this order." } }, { status: 409 });
  if (claim.status === "disabled") return NextResponse.json({ error: { message: "CPUX Calendar writes are disabled outside the explicitly enabled production runtime." } }, { status: 503 });
  if (claim.status === "busy") return NextResponse.json({ error: { message: "Another CPUX Calendar delivery is active for this order." } }, { status: 503, headers: { "retry-after": "10" } });

  try {
    let quoteArtifact: { revisionId: string; driveFileId: string } | undefined;
    if (order.origin === "hospitality_booking") {
      const context = await hubJson(request, `/api/production/calendar-quote?bookingId=${encodeURIComponent(order.sourceBookingId)}`, { method: "GET" },
        (value): value is { order: ProductionOrder; quote?: { revisionId: string; driveFileId: string } } => {
          const context = value as { order?: ProductionOrder; quote?: { revisionId?: unknown; driveFileId?: unknown } } | null;
          return typeof context?.order?.canonicalId === "string" && Number.isInteger(context.order.version)
            && (!context.quote || (typeof context.quote.revisionId === "string" && typeof context.quote.driveFileId === "string"));
        });
      if (context.order.canonicalId !== order.canonicalId || context.order.version !== order.version) {
        await releaseCpuXCalendarOrderClaim(body.canonicalId, claim.claimId, calendarIdentity);
        return NextResponse.json({ applied: false, status: "superseded" });
      }
      order = context.order;
      quoteArtifact = context.quote;
    }
    const result = await applyCpuXCalendarOrder(order, { quoteArtifact });
    await finishCpuXCalendarOrder(body.canonicalId, claim.claimId, body.sourceVersion, result.operation, calendarIdentity);
    return NextResponse.json({ applied: result.applied, status: result.operation, eventId: result.eventId });
  } catch (error) {
    await releaseCpuXCalendarOrderClaim(body.canonicalId, claim.claimId, calendarIdentity);
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPUX Calendar publication failed." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
