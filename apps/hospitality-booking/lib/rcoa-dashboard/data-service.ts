import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildRcoaDashboardRows, type RcoaDashboardService } from "./model";
import { hasRcoaSession } from "./session";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };
const dashboardServiceSchema = z.object({
  reference: z.string().min(1),
  eventType: z.string(),
  eventDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  location: z.string(),
  guestCount: z.number().nullable(),
  lifecycleStatus: z.string().min(1),
  amended: z.boolean(),
  groupId: z.string().optional(),
  groupSize: z.number().int().positive().optional(),
  groupSequence: z.number().int().positive().optional(),
  items: z.array(z.object({ name: z.string().min(1), quantity: z.number().nullable() }).strict()),
}).strict();

async function readCanonicalBookings() {
  const base = process.env.FIKA_HUB_BASE_URL?.trim().replace(/\/$/, "");
  const token = process.env.RCOA_DASHBOARD_BRIDGE_TOKEN?.trim();
  if (!base || !token) throw new Error("Dashboard data access is not configured.");
  const response = await fetch(`${base}/api/rcoa-bookings`, {
    headers: { "x-fika-rcoa-dashboard-token": token, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Canonical Hospitality data is unavailable.");
  const body = await response.json() as { bookings?: unknown };
  if (!Array.isArray(body.bookings)) throw new Error("Canonical Hospitality data returned an unexpected response.");
  return z.array(dashboardServiceSchema).parse(body.bookings) as RcoaDashboardService[];
}

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function rcoaDashboardDataResponse(
  request: NextRequest,
  dependencies: { readBookings?: typeof readCanonicalBookings } = {},
) {
  if (!hasRcoaSession(request)) return NextResponse.json({ error: "A RCoA dashboard session is required." }, { status: 401, headers: privateHeaders });
  try {
    const projected = buildRcoaDashboardRows(await (dependencies.readBookings || readCanonicalBookings)());
    const today = londonToday();
    const upcoming = projected.filter(booking => booking.date >= today && booking.status === "Upcoming").length;
    const completed = projected.filter(booking => booking.persistedCompleted).length;
    const cancelled = projected.filter(booking => booking.persistedCancelled).length;
    return NextResponse.json({ bookings: projected, counts: { upcoming, completed, cancelled, total: projected.length } }, { headers: privateHeaders });
  } catch (error) {
    console.error("hospitality.rcoa-dashboard.read-failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Bookings are temporarily unavailable. Please try again shortly." }, { status: 503, headers: privateHeaders });
  }
}
