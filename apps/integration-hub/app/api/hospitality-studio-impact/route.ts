import type { NextRequest } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { getActiveCanonicalOplocLabels } from "@/lib/canonical-oplocs";
import { requireBoundFikaSession } from "@/lib/fika-session";
import { db } from "@/lib/firebase-admin";
import { requireStudioImpactAccess } from "@/lib/hospitality-studio-impact/authorization";
import { impactRequest } from "@/lib/hospitality-studio-impact/impact";
import { readStudioBookingImpact } from "@/lib/hospitality-studio-impact/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Explicit read-only review request. Booking records, audit and delivery are unchanged. */
export function POST(request: NextRequest) {
  return withDataTrace({
    app: "integration-hub", action: "integration-hub.hospitality-studio-impact.read", path: "/api/hospitality-studio-impact",
  }, async () => {
    try {
      await db.runTransaction(async transaction => {
        // Current-only AUTHMOD reads avoid the ordinary missing-package bootstrap path.
        const repository = new FirestoreAuthModRepository("hospitality-studio-impact", undefined, transaction);
        const session = await requireBoundFikaSession(request, repository);
        const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName };
        await requireStudioImpactAccess(repository, principal);
      }, { readOnly: true });

      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return problem(415);
      if (Number(request.headers.get("content-length")) > 16_384) return problem(413);
      const text = await request.text();
      if (Buffer.byteLength(text) > 16_384) return problem(413);
      let body: unknown;
      try { body = JSON.parse(text); }
      catch { return problem(422); }
      const parsed = impactRequest.safeParse(body);
      if (!parsed.success) return problem(422);
      const result = await readStudioBookingImpact(db, parsed.data, ids => getActiveCanonicalOplocLabels(ids.slice(0, 50)));
      return Response.json(result, { headers });
    } catch (error) {
      const upstreamStatus = (error as { status?: number }).status;
      return problem(upstreamStatus === 401 || upstreamStatus === 403 ? upstreamStatus : 503);
    }
  });
}

function problem(status: number) {
  const code = status === 401 || status === 403 ? "HOSPITALITY_STUDIO_IMPACT_ACCESS"
    : status < 500 ? "HOSPITALITY_STUDIO_IMPACT_REQUEST"
    : "HOSPITALITY_STUDIO_IMPACT_UNAVAILABLE";
  return Response.json({ error: { code } }, { status, headers });
}
