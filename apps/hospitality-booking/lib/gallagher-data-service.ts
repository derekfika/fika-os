import { NextRequest, NextResponse } from "next/server";
import { aggregateGallagherBookings } from "@/lib/gallagher-dashboard";
import { getGallagherLegacyRows } from "@/lib/gallagher-legacy-sheet";
import { hasGallagherSession } from "@/lib/gallagher-session";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function readFikaBookings() {
  const base = process.env.FIKA_HUB_BASE_URL?.trim().replace(/\/$/, "");
  const token = process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN?.trim();
  if (!base || !token) throw new Error("Gallagher canonical booking access is not configured.");
  const response = await fetch(`${base}/api/gallagher-bookings`, {
    headers: { "x-fika-gallagher-bridge-token": token, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Canonical Hospitality data is unavailable (HTTP ${response.status}).`);
  const body = await response.json() as { bookings?: unknown };
  if (!Array.isArray(body.bookings)) throw new Error("Canonical Hospitality data returned an unexpected response.");
  return body.bookings as Array<Record<string, any>>;
}

export async function gallagherDataResponse(
  request: NextRequest,
  dependencies: { readLegacy?: typeof getGallagherLegacyRows; readFika?: typeof readFikaBookings } = {},
) {
  if (!hasGallagherSession(request)) return NextResponse.json({ error: "A Gallagher dashboard session is required." }, { status: 401, headers: privateHeaders });
  try {
    const [legacyRows, fikaRows] = await Promise.all([(dependencies.readLegacy || getGallagherLegacyRows)(), (dependencies.readFika || readFikaBookings)()]);
    const result = aggregateGallagherBookings(legacyRows, fikaRows, londonToday());
    const bookings = result.bookings.map(({ matchedBy: _matchedBy, supersededLegacyBookingId: _superseded, ...booking }) => booking);
    return NextResponse.json({ ...result, bookings }, { headers: privateHeaders });
  } catch (error) {
    console.error("hospitality.gallagher-dashboard.read-failed", { message: (error as Error).message });
    return NextResponse.json({ error: "Bookings are temporarily unavailable. Please try again shortly." }, { status: 503, headers: privateHeaders });
  }
}
