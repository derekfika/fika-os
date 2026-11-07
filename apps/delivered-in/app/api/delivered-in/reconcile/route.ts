import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { containArtifactLinks } from "@/lib/artifact-containment";
import { NextRequest, NextResponse } from "next/server";
import { reconcileDeliveredInDay } from "@/lib/delivered-in-reconciliation";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { requireDeliveredInMaintenance } from "@/lib/maintenance-auth";

async function safeJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(containArtifactLinks(data, await stagingDriveAccessBlocked()), init);
}

export const dynamic = "force-dynamic";

async function handlePost(request: NextRequest) {
  try {
    requireDeliveredInMaintenance(request);
    const body = await request.json() as { oplocId?: string; serviceDate?: string };
    if (!body.oplocId || !body.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate)) return safeJson({ error: { message: "An OPLOC and valid service date are required." } }, { status: 422 });
    return safeJson(await reconcileDeliveredInDay(request, body.oplocId, body.serviceDate, { reconciliationContext: { mode: "internal", oplocId: body.oplocId, serviceDate: body.serviceDate } }));
  } catch (error) { return safeJson({ error: { message: error instanceof Error ? error.message : "Delivered-In reconciliation failed." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}

export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.projection.reconcile", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
