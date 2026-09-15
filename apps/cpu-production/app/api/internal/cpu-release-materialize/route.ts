import { NextRequest, NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { materializeCommittedCpuRelease } from "../../../../lib/cpu-release-materialization";

export const dynamic = "force-dynamic";

function allowed(request: NextRequest) {
  const token = process.env.FIKA_INTERNAL_API_TOKEN?.trim();
  return Boolean(token && request.headers.get("x-fika-internal-token") === token);
}

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "cpu-production", action: "cpu-production.release-materialize", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, async () => {
    if (!allowed(request)) return NextResponse.json({ error: { message: "Internal authentication is required." } }, { status: 401 });
    const body = await request.json().catch(() => undefined) as { orderId?: unknown; releaseId?: unknown } | undefined;
    if (!body || typeof body.orderId !== "string" || typeof body.releaseId !== "string") return NextResponse.json({ error: { message: "A bounded CPU release materialization command is required." } }, { status: 422 });
    try {
      const result = await materializeCommittedCpuRelease(request, body.orderId, body.releaseId);
      return NextResponse.json({ status: result.alreadyMaterialized ? "already_materialized" : "materialized", plan: result.plan });
    } catch (error) {
      return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU release materialization failed." } }, { status: Number((error as { status?: number }).status) || 502 });
    }
  });
}
