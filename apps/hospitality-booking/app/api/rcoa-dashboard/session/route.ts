import { NextRequest, NextResponse } from "next/server";
import {
  clearRcoaFailedPinAttempts,
  createRcoaSession,
  rcoaPinAttemptRateLimited,
  rcoaSessionCookie,
  rcoaSessionReady,
  recordRcoaFailedPinAttempt,
  verifyRcoaPin,
} from "@/lib/rcoa-dashboard/session";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(request: NextRequest) {
  if (rcoaPinAttemptRateLimited(request)) return NextResponse.json({ error: "Too many incorrect PIN attempts. Try again later." }, { status: 429, headers: { ...privateHeaders, "Retry-After": "900" } });
  if (!rcoaSessionReady()) return NextResponse.json({ error: "The RCoA dashboard is not configured." }, { status: 503, headers: privateHeaders });
  let pin = "";
  try { const body = await request.json() as { pin?: unknown }; if (typeof body.pin === "string") pin = body.pin; } catch { /* Invalid JSON is a failed attempt. */ }
  if (!await verifyRcoaPin(pin)) {
    recordRcoaFailedPinAttempt(request);
    return NextResponse.json({ error: "That PIN was not accepted." }, { status: 401, headers: privateHeaders });
  }
  clearRcoaFailedPinAttempts(request);
  const response = NextResponse.json({ authenticated: true }, { headers: privateHeaders });
  response.headers.append("Set-Cookie", rcoaSessionCookie(createRcoaSession()));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: privateHeaders });
  response.headers.append("Set-Cookie", rcoaSessionCookie("", 0));
  return response;
}
