import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { invalidateUsageCache, loadUsageDashboard, londonDayStart, parseUsageRange } from "@/lib/usage-observatory";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function respond(request: NextRequest, refresh: boolean) {
  await requireAuthmodAdminContext(request);
  const params = request.nextUrl.searchParams;
  const start = params.get("start");
  const end = params.get("end");
  const preset = params.get("preset");
  if (refresh) invalidateUsageCache();
  const now = new Date();
  const presetMinutes: Record<string, number> = { "5m": 5, "15m": 15, "30m": 30, "1h": 60, "24h": 24 * 60, "7d": 7 * 24 * 60 };
  const range = start && end ? parseUsageRange({ start, end }, now) : preset === "today" ? parseUsageRange({ start: londonDayStart(now).toISOString(), end: now.toISOString() }, now) : preset && presetMinutes[preset] ? parseUsageRange({ start: new Date(now.getTime() - presetMinutes[preset] * 60000).toISOString(), end: now.toISOString() }, now) : undefined;
  return NextResponse.json(await loadUsageDashboard({ range }), { headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "usage-observatory.load", path: request.nextUrl.pathname, dataset: "integration-hub/usage-observatory-control-plane", requestId: request.headers.get("x-request-id") || undefined }, async () => { try { return await respond(request, false); } catch (error) { return errorResponse(error); } }); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "usage-observatory.refresh", path: request.nextUrl.pathname, dataset: "integration-hub/usage-observatory-control-plane", requestId: request.headers.get("x-request-id") || undefined }, async () => { try { return await respond(request, true); } catch (error) { return errorResponse(error); } }); }
