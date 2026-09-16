import { NextRequest, NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { processCpuPostCommitJob, type CpuPostCommitJob } from "../../../../lib/cpu-post-commit-worker";

export const dynamic = "force-dynamic";

function isJob(value: unknown): value is CpuPostCommitJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<CpuPostCommitJob>;
  return job.action === "master-sign" && typeof job.commandId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.serviceDate || "") && Array.isArray(job.orderIds) && job.orderIds.length > 0 && job.orderIds.length <= 100 && job.orderIds.every(orderId => typeof orderId === "string" && orderId.length > 0);
}

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "cpu-production", action: "cpu-production.post-commit-worker", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, async () => {
    if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPU post-commit access is not authorised." } }, { status: 401 });
    const body = await request.json().catch(() => undefined);
    if (!isJob(body)) return NextResponse.json({ error: { message: "A bounded CPU post-commit job is required." } }, { status: 422 });
    try {
      return NextResponse.json(await processCpuPostCommitJob(request, body));
    } catch (error) {
      return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU post-commit work failed." } }, { status: Number((error as { status?: number }).status) || 502 });
    }
  });
}
