import { NextRequest, NextResponse } from "next/server";
import { invalidateLogisticsProjection } from "@/lib/store";
import { reconcileLogisticsDay } from "@/lib/logistics-materialisation";
import type { LogisticsProjectionInvalidation } from "@/lib/logistics-projection";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { LOGISTICS_PROJECTION_CHANGE_TYPES } from "../../../../../shared/logistics-projection";

function internalAllowed(request: NextRequest) {
  // internalTokenAllowed validates the x-fika-internal-token header.
  return internalTokenAllowed(request);
}

async function handlePost(request: NextRequest) {
  if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  const body = await request.json().catch(() => undefined) as unknown;
  const changes = Array.isArray((body as { changes?: unknown[] } | undefined)?.changes)
    ? (body as { changes: unknown[] }).changes
    : [body];
  if (!changes.length || changes.length > 25 || !changes.every(isCompleteChange)) return NextResponse.json({ error: { message: "A complete Logistics projection invalidation is required." } }, { status: 422 });
  try {
    const typedChanges = changes as LogisticsProjectionInvalidation[];
    const results = [];
    for (const change of typedChanges) results.push(await invalidateLogisticsProjection(change));
    const dates = [...new Set(typedChanges.map(change => change.serviceDate))];
    const reconciled = [];
    for (const date of dates) {
      const dateChanges = typedChanges.filter(change => change.serviceDate === date);
      reconciled.push(await reconcileLogisticsDay(date, "source:integration-hub", "system:integration-hub-invalidation", request.headers.get("cookie") || undefined, undefined, dateChanges));
    }
    if (typedChanges.length === 1) {
      return NextResponse.json({ ...results[0], materialised: results[0].reason === "missing-projection", ...reconciled[0] });
    }
    return NextResponse.json({ changes: results, reconciled: reconciled.map(item => ({ serviceDate: item.projection.serviceDate, created: item.created, updated: item.updated, projectionState: item.projection.state })) });
  } catch (error) {
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const message = error instanceof Error ? error.message.slice(0, 500) : "Logistics projection reconciliation failed.";
    return NextResponse.json({ error: { message: `Logistics projection reconciliation failed: ${message}`, requestId } }, { status: 502, headers: { "x-request-id": requestId } });
  }
}

function isCompleteChange(value: unknown): value is LogisticsProjectionInvalidation {
  const change = value as Partial<LogisticsProjectionInvalidation> | undefined;
  return Boolean(change && typeof change.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(change.serviceDate) && typeof change.sourceDomain === "string" && change.sourceDomain.length > 0 && typeof change.sourceEntityId === "string" && change.sourceEntityId.length > 0 && typeof change.sourceVersion === "number" && Number.isInteger(change.sourceVersion) && change.sourceVersion >= 1 && typeof change.changedAt === "string" && change.changedAt.length > 0 && typeof change.changeType === "string" && LOGISTICS_PROJECTION_CHANGE_TYPES.includes(change.changeType as typeof LOGISTICS_PROJECTION_CHANGE_TYPES[number]));
}

export async function POST(request: NextRequest) { return withDataTrace({ app: "logistics", action: "logistics.projection.invalidate", path: request.nextUrl.pathname }, () => handlePost(request)); }
