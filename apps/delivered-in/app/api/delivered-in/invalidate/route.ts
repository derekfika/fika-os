import { NextRequest, NextResponse } from "next/server";
import { invalidateDeliveredInProjection } from "@/lib/delivered-in-invalidation";
import type { DeliveredInInvalidation } from "@/lib/delivered-in-projection-store";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

function internalAllowed(request: NextRequest) {
  const configured = process.env.FIKA_INTERNAL_API_TOKEN;
  return Boolean(configured && request.headers.get("x-fika-internal-token") === configured);
}
function validInput(value: unknown): value is DeliveredInInvalidation {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ["menu-planning", "cpu-production", "integration-hub"].includes(String(input.sourceDomain)) && typeof input.sourceEntityId === "string" && input.sourceEntityId.length > 0 && input.sourceEntityId.length <= 200 && (input.publicationId === undefined || typeof input.publicationId === "string" && input.publicationId.length <= 200) && typeof input.eventId === "string" && input.eventId.length > 0 && input.eventId.length <= 200 && ["changed", "amended", "withdrawn", "superseded"].includes(String(input.eventType)) && typeof input.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate) && typeof input.oplocId === "string" && input.oplocId.length > 0 && input.oplocId.length <= 200 && (input.sourceVersion === undefined || typeof input.sourceVersion === "string") && (input.contentHash === undefined || typeof input.contentHash === "string");
}
async function handlePost(request: NextRequest) {
  if (!internalAllowed(request)) return NextResponse.json({ error: { message: "Internal authentication is required." } }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  if (!validInput(body)) return NextResponse.json({ error: { message: "A bounded invalidation scope and source identity are required." } }, { status: 422 });
  return NextResponse.json(await invalidateDeliveredInProjection(request, body));
}
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.projection.invalidate", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
