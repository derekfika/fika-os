import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { containArtifactLinks } from "@/lib/artifact-containment";
import { NextRequest, NextResponse } from "next/server";
import { projectedWeeks } from "@/lib/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function safeJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(containArtifactLinks(data, await stagingDriveAccessBlocked()), init);
}

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  try {
    const oplocId = request.nextUrl.searchParams.get("oplocId");
    const serviceDate = request.nextUrl.searchParams.get("serviceDate");
    if (!oplocId || !serviceDate) return safeJson({ error: { message: "An OPLOC and service date are required." } }, { status: 422 });
    const result = await projectedWeeks(request, oplocId);
    const day = result.weeks.flatMap(week => week.days).find(candidate => candidate.date === serviceDate);
    if (!day) return safeJson({ error: { message: "The Delivered-In day projection was not found." } }, { status: 404 });
    return safeJson({ projection: day }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return safeJson({ error: { message: error instanceof Error ? error.message : "The Delivered-In projection could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.day-projection.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
