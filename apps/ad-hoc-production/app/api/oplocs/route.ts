import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { callerFor, isHubError } from "../../../lib/hub-client";

// Authorised destinations, resolved by the Hub from the caller's own session.
export async function GET(request: NextRequest) {
  return withDataTrace({ app: "ad-hoc-production", action: "oploc.list", path: "/api/oplocs", outcome: "SUCCESS" }, async () => {
    try {
      const { access } = await callerFor(request, { oplocs: true });
      recordDataAccess({ operation: "oploc.list", source: "NETWORK_UPSTREAM", documents: 0, dataset: "ad-hoc-production/oplocs" });
      return NextResponse.json({ oplocs: access.oplocs || [], ...(access.redirects ? { redirects: access.redirects } : {}) }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      setDataTraceOutcome("ERROR");
      const status = isHubError(error) ? error.status : 503;
      return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not load OPLOC destinations." } }, { status });
    }
  });
}
