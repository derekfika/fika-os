import { NextRequest, NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { processAuthorityRevocation } from "../../../../lib/allergen-reuse-orchestrator";
import { reuseRuntimeDeps } from "../../../../lib/allergen-reuse-runtime";

export const dynamic = "force-dynamic";

function allowed(request: NextRequest) {
  const token = process.env.FIKA_INTERNAL_API_TOKEN?.trim();
  return Boolean(token && request.headers.get("x-fika-internal-token") === token);
}

/** Durable outbox work: make every booking that reused a revoked allergen authority non-authoritative. Idempotent; retried until complete. */
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "cpu-production", action: "cpu-production.allergen-authority-revoked", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, async () => {
    if (!allowed(request)) return NextResponse.json({ error: { message: "Internal authentication is required." } }, { status: 401 });
    const body = await request.json().catch(() => undefined) as { compositionId?: unknown; generation?: unknown; releaseId?: unknown; actor?: unknown; actorId?: unknown; at?: unknown; reason?: unknown } | undefined;
    if (!body || typeof body.compositionId !== "string" || typeof body.releaseId !== "string" || typeof body.generation !== "number" || typeof body.at !== "string") return NextResponse.json({ error: { message: "A bounded allergen authority revocation command is required." } }, { status: 422 });
    try {
      const result = await processAuthorityRevocation(reuseRuntimeDeps(request), { compositionId: body.compositionId, generation: body.generation, releaseId: body.releaseId, actor: typeof body.actor === "string" ? body.actor : "system", actorId: typeof body.actorId === "string" ? body.actorId : "system", at: body.at, reason: typeof body.reason === "string" ? body.reason : "The shared allergen authority was revoked." });
      return NextResponse.json({ status: result.status });
    } catch (error) {
      return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The allergen authority cascade failed." } }, { status: Number((error as { status?: number }).status) || 502 });
    }
  });
}
