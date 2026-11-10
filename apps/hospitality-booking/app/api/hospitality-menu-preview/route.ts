import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || "";
  const oplocId = request.nextUrl.searchParams.get("oplocId") || "";
  if (!date || !oplocId) return NextResponse.json({ error: { message: "A booking service date and canonical OPLOC are required." } }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  try {
    const query = new URLSearchParams({ date, oplocId });
    const upstream = await hubUserFetch(`/api/hospitality-menu-preview?${query}`, request.headers.get("cookie"), { signal: AbortSignal.timeout(10_000) });
    const raw = await upstream.text();
    return new Response(raw, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu preview is unavailable." } }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}