import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { hubJson } from "../../../lib/production-http-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // This human-facing link always uses the user's session; an internal token is not a browser credential.
    if (!request.headers.get("cookie")) throw Object.assign(new Error("Sign in to FIKA OS to open this quote."), { status: 401 });
    const bookingId = request.nextUrl.searchParams.get("bookingId") || "";
    if (!/^booking:[^\s]{1,200}$/.test(bookingId)) throw Object.assign(new Error("A canonical Booking ID is required."), { status: 400 });
    const interactive = new NextRequest(request.url, { headers: { cookie: request.headers.get("cookie")! } });
    const result = await hubJson(interactive, `/api/production/calendar-quote?bookingId=${encodeURIComponent(bookingId)}`, { method: "GET" },
      (value): value is { quote: { driveFileId: string; url: string } } => {
        const quote = (value as { quote?: { driveFileId?: unknown; url?: unknown } } | null)?.quote;
        return typeof quote?.driveFileId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(quote.driveFileId)
          && quote.url === `https://drive.google.com/file/d/${encodeURIComponent(quote.driveFileId)}/view`;
      });
    return NextResponse.redirect(result.quote.url, { status: 307, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
