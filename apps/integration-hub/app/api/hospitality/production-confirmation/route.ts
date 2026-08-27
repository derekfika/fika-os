import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { notifyBookingConfirmedForProductionOrder } from "@/lib/hospitality-booking-service";

const Command = z.object({ action: z.literal("notify-booking-confirmed"), sourceBookingId: z.string().trim().min(8) }).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]);
    assertPermission(actor, "canonical.edit");
    const command = Command.parse(await request.json());
    return NextResponse.json(await notifyBookingConfirmedForProductionOrder(command.sourceBookingId), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
