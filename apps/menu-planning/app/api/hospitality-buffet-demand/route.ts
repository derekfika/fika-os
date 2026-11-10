import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessOploc, resolveMenuActor } from "@/lib/auth";
import { menuPlanningHubBaseUrl } from "@/lib/hub-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveMenuActor(request);
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    const oplocId = request.nextUrl.searchParams.get("oplocId") || "";
    if (oplocId && !actorCanAccessOploc(actor, oplocId) || !oplocId && !actor.allOplocs && actor.oplocIds.length === 0) throw Object.assign(new Error("This Menu Planning identity is not authorised for Hospitality demand."), { status: 403 });
    const query = new URLSearchParams({ from, to, ...(oplocId ? { oplocId } : {}) });
    const upstream = await fetch(`${menuPlanningHubBaseUrl()}/api/hospitality-buffet-demand?${query}`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
    const raw = await upstream.text();
    return new Response(raw, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "private, no-store" } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Hot Fork Buffet demand is unavailable." } }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
