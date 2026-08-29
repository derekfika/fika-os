import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { invalidateUsageCache, loadUsageDashboard, londonDayStart, parseUsageRange } from "@/lib/usage-observatory";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";

async function respond(request: NextRequest, refresh: boolean) {
  await requireAuthmodAdminContext(request);
  const params = request.nextUrl.searchParams;
  const start = params.get("start");
  const end = params.get("end");
  const preset = params.get("preset");
  if (refresh) invalidateUsageCache();
  const now = new Date();
  const range = start && end ? parseUsageRange({ start, end }, now) : preset === "today" ? parseUsageRange({ start: londonDayStart(now).toISOString(), end: now.toISOString() }, now) : preset === "24h" ? parseUsageRange({ start: new Date(now.getTime() - 86400000).toISOString(), end: now.toISOString() }, now) : undefined;
  return NextResponse.json(await loadUsageDashboard({ range }), { headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: NextRequest) { try { return await respond(request, false); } catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) { try { return await respond(request, true); } catch (error) { return errorResponse(error); } }
