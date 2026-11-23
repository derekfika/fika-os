import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { rcoaInvoiceReport, requireRcoaInvoiceReportAuthority, resolveRcoaInvoiceSourceOploc } from "@/lib/rcoa-invoice-report";

const Range = z.object({ startDate: z.iso.date(), endDate: z.iso.date() }).strict().refine(value => value.endDate >= value.startDate, {
  message: "Choose an end date on or after the start date.",
});
const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

/** Financially sensitive, read-only RCoA report. Site and authority scope come from Hub records, never request parameters. */
export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.rcoa-invoice-report.read", path: "/api/rcoa-invoice-report", requestId: request.headers.get("x-request-id") || undefined }, async () => {
    try {
      const range = Range.parse({
        startDate: request.nextUrl.searchParams.get("startDate"),
        endDate: request.nextUrl.searchParams.get("endDate"),
      });
      const actor = await requireActor(request);
      assertPermission(actor, "canonical.view");
      const session = await requireFikaSession(request);
      const repository = new FirestoreAuthModRepository();
      const oplocId = await resolveRcoaInvoiceSourceOploc();
      const redirects = await repository.listOplocRedirects();
      const visited = new Set<string>();
      let canonicalOplocId = oplocId;
      while (Object.hasOwn(redirects, canonicalOplocId)) {
        if (visited.has(canonicalOplocId) || visited.size >= 10) throw Object.assign(new Error("RCoA reporting location identity is invalid."), { status: 503 });
        visited.add(canonicalOplocId);
        canonicalOplocId = redirects[canonicalOplocId];
      }
      const active = await repository.getActiveOploc(canonicalOplocId);
      if (!active || active.id !== canonicalOplocId) throw Object.assign(new Error("RCoA reporting location is unavailable."), { status: 503 });
      const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
      await requireRcoaInvoiceReportAuthority(repository, principal, canonicalOplocId);
      const report = await rcoaInvoiceReport({ ...range, oplocId: canonicalOplocId, oplocRedirects: redirects });
      return NextResponse.json(report, { headers: privateHeaders });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
