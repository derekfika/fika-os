import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { adHocCaller } from "@/lib/ad-hoc-production-auth";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

// Identity + authorised destinations for Ad-Hoc Production, resolved from the
// caller's own session (forwarded by the Ad-Hoc server). Mirrors the CPU
// Production access route; read-only.
async function handleGet(request: NextRequest) {
  try {
    const { access } = await adHocCaller(request);
    return NextResponse.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.ad-hoc-production-admission", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request));
}
