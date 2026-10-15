import { NextRequest, NextResponse } from "next/server";
import {
  clearFailedPinAttempts,
  createGallagherSession,
  gallagherSessionCookie,
  gallagherSessionReady,
  pinAttemptRateLimited,
  recordFailedPinAttempt,
  verifyGallagherPin,
} from "@/lib/gallagher-session";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(request: NextRequest) {
  if (pinAttemptRateLimited(request)) return NextResponse.json({ error: "Too many incorrect PIN attempts. Try again later." }, { status: 429, headers: { ...privateHeaders, "Retry-After": "900" } });
  if (!gallagherSessionReady()) return NextResponse.json({ error: "The Gallagher dashboard is not configured." }, { status: 503, headers: privateHeaders });
  let pin = "";
  try {
    const body = await request.json() as { pin?: unknown };
    if (typeof body.pin === "string") pin = body.pin;
  } catch { /* Invalid JSON counts as a failed attempt below. */ }
  if (!await verifyGallagherPin(pin)) {
    recordFailedPinAttempt(request);
    return NextResponse.json({ error: "That PIN was not accepted." }, { status: 401, headers: privateHeaders });
  }
  clearFailedPinAttempts(request);
  const response = NextResponse.json({ authenticated: true }, { headers: privateHeaders });
  response.headers.append("Set-Cookie", gallagherSessionCookie(createGallagherSession()));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: privateHeaders });
  response.headers.append("Set-Cookie", gallagherSessionCookie("", 0));
  return response;
}
