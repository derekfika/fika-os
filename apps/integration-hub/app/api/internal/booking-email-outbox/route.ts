import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { bookingEmailStore } from "@/lib/booking-email-firestore";
import { runBookingEmailWorker } from "@/lib/booking-email-outbox";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: "Internal access required." }, { status: 403 });
  // Deliberate kill switch: deploying code must not begin sending queued customer mail.
  if (process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "true") return NextResponse.json({ enabled: false, attempted: 0 });
  const body = await request.json().catch(() => ({})) as { limit?: number };
  try { return NextResponse.json(await runBookingEmailWorker(bookingEmailStore, body.limit)); }
  catch (error) { console.error("hospitality.email.worker.failed", { errorType: error instanceof Error ? error.name : "UnknownError" }); return NextResponse.json({ error: "Booking email worker failed; inspect structured server diagnostics." }, { status: 502 }); }
}
