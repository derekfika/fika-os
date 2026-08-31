import { NextResponse } from "next/server";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";

export async function GET(request: Request) {
  const origin = process.env.FIKA_HUB_ORIGIN || "http://localhost:3200";
  return withDataTrace({ app: "ad-hoc-production", action: "oploc.list", path: "/api/oplocs", outcome: "SUCCESS" }, async () => { try {
    const response = await fetch(`${origin}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    recordDataAccess({ operation: "oploc.list", source: "NETWORK_UPSTREAM", documents: 0, dataset: "ad-hoc-production/oplocs" });
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) { setDataTraceOutcome("ERROR");
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not load active OPLOCs." } }, { status: 503 });
  } });
}
