import { NextRequest, NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { applyCpuReleaseEvent, type CpuReleaseEvent } from "@/lib/cpu-release-events";

export const dynamic = "force-dynamic";
function allowed(request: NextRequest) { const token = process.env.DELIVERED_IN_INTERNAL_API_TOKEN || process.env.FIKA_INTERNAL_API_TOKEN; return Boolean(token && request.headers.get("x-fika-internal-token") === token); }
function valid(value: unknown): value is CpuReleaseEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["published", "revoked"].includes(String(v.eventType)) && typeof v.eventId === "string" && typeof v.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.serviceDate) && typeof v.oplocId === "string" && typeof v.sourceDayId === "string" && typeof v.sourcePublicationDayId === "string" && Number.isInteger(v.sourceVersion) && typeof v.sourceContentHash === "string" && typeof v.releaseId === "string" && typeof v.releaseVersion === "string" && typeof v.packetContentHash === "string" && (v.changedDishIds === undefined || Array.isArray(v.changedDishIds) && v.changedDishIds.every(item => typeof item === "string"));
}
async function post(request: NextRequest) {
  if (!allowed(request)) return NextResponse.json({ error: { message: "Internal authentication is required." } }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  if (!valid(body)) return NextResponse.json({ error: { message: "A bounded CPU release event is required." } }, { status: 422 });
  try { return NextResponse.json(await applyCpuReleaseEvent(request, body)); } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU release event could not be applied." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.cpu-release-event", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => post(request)); }
