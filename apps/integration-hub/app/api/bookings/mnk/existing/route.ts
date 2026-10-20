import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBridgeAccess } from "@/lib/hospitality-bridge-auth";
import { canonicalBookingId } from "@/lib/hospitality-booking-service";
import { db } from "@/lib/firebase-admin";
import { errorResponse } from "@/lib/api";

/** Bounded existence-only retry check; no booking/customer data or write side effects. */
export async function POST(request: NextRequest) {
  try {
    requireBridgeAccess(request);
    const { bookingIds } = z.object({ bookingIds: z.array(z.string().min(1).max(240)).min(1).max(12) }).strict().parse(await request.json());
    const ids = [...new Set(bookingIds)];
    const records = await db.getAll(...ids.map(id => db.collection("fikaBookings").doc(canonicalBookingId(id, "rcoa"))));
    return NextResponse.json({ existingBookingIds: ids.filter((_, index) => records[index].exists && records[index].data()?.service?.portalSiteId === "rcoa") });
  } catch (error) { return errorResponse(error); }
}
