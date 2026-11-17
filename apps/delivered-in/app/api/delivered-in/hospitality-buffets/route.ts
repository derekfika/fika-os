import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { recordDeliveredInAppReadBudget } from "@/lib/delivered-in-read-budget";
import { assertAuthorisedOploc } from "@/lib/projection";
import { deliveredInErrorBody, resolveAccess } from "@/lib/server";
import { credentialedUpstreamBase } from "@/lib/upstream-config";

export const dynamic = "force-dynamic";
const hubBase = () => credentialedUpstreamBase("hub", process.env.INTEGRATION_HUB_BASE_URL, "http://localhost:3200");

async function handleGet(request: NextRequest) {
  try {
    const oplocId = request.nextUrl.searchParams.get("oplocId");
    const serviceDate = request.nextUrl.searchParams.get("serviceDate");
    if (!oplocId || !serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return NextResponse.json({ error: { message: "An OPLOC and service date are required." } }, { status: 422 });
    const resolved = await resolveAccess(request, "delivered-in", { serviceDate });
    assertAuthorisedOploc(resolved.access, oplocId);
    if (!resolved.sites.some(site => site.oplocId === oplocId)) return NextResponse.json({ error: { message: "Delivered-In service is not active for this site." } }, { status: 403 });
    const url = new URL(`${hubBase()}/api/delivered-in/hospitality-buffets`);
    url.searchParams.set("oplocId", oplocId);
    url.searchParams.set("serviceDate", serviceDate);
    const response = await fetch(url, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => undefined);
    recordDataAccess({ app: "delivered-in", operation: "hub.hospitality-buffet-orders.by-service-date", source: "NETWORK_UPSTREAM", dataset: "integration-hub/production-orders", documents: 0, cacheResult: "BYPASS" });
    const recordsInspected = body && typeof body === "object" && Array.isArray((body as { orders?: unknown[] }).orders) ? (body as { orders: unknown[] }).orders.length : 0;
    recordDeliveredInAppReadBudget({ stage: "hospitality_buffet_orders", upstreamRequests: 1, recordsInspected, serviceDate, oplocId });
    if (!body || typeof body !== "object") throw Object.assign(new Error("Hospitality buffet service data could not be read."), { status: 502 });
    return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(deliveredInErrorBody(error, "Hospitality buffet service data could not be loaded."), { status: Number((error as { status?: number }).status) || 502 });
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "delivered-in", action: "delivered-in.hospitality-buffets.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request));
}
