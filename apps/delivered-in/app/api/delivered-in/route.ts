import { NextRequest, NextResponse } from "next/server";
import { projectionHead, projectedWeeks } from "@/lib/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("head") === "1") {
      const result = await projectionHead(request, request.nextUrl.searchParams.get("oplocId") || undefined, request.nextUrl.searchParams.get("week") || undefined);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const result = await projectedWeeks(request, request.nextUrl.searchParams.get("oplocId") || undefined, { requestedWeek: request.nextUrl.searchParams.get("week") || undefined });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Delivered-In dashboard load failed", {
      app: "delivered-in",
      operation: "delivered-in.load",
      requestedWeek: request.nextUrl.searchParams.get("week") || undefined,
      oplocId: request.nextUrl.searchParams.get("oplocId") || undefined,
      packageClassification: error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined,
      recoveryAttempted: Boolean(request.nextUrl.searchParams.get("week")),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestId: request.headers.get("x-request-id") || undefined,
      buildSha: process.env.FIKA_BUILD_SHA || undefined,
    });
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
