import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { replayBookingEmail } from "@/lib/booking-email-firestore";
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: "Internal access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { notificationId?: unknown; reason?: unknown; providerEvidence?: unknown; confirmedNotSent?: unknown };
  if (typeof body.notificationId !== "string" || body.notificationId.length > 1000 || body.notificationId.includes("/") || typeof body.reason !== "string" || body.reason.trim().length < 10 || typeof body.providerEvidence !== "string" || body.providerEvidence.trim().length < 10 || body.confirmedNotSent !== true) return NextResponse.json({ error: "Exact notification identity, reason, provider evidence and explicit confirmation of non-delivery required." }, { status: 422 });
  try { return NextResponse.json(await replayBookingEmail(body.notificationId, body.reason.slice(0, 1000), body.providerEvidence.slice(0, 1000))); }
  catch { return NextResponse.json({ error: "Notification is not eligible for safe replay." }, { status: 409 }); }
}
