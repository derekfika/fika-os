import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { requireFikaSession } from "@/lib/fika-session";
import { assertHospitalityBookingMutationAccess } from "@/lib/hospitality-booking-authorization";
import { cancelHospitalityBookingGroup } from "@/lib/hospitality-booking-service";

const Command = z.object({ bookingGroupId: z.string().min(8), expectedSourceHash: z.string().min(16), reason: z.string().trim().min(3).max(1000) }).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.edit");
    const input = Command.parse(await request.json());
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const result = await cancelHospitalityBookingGroup(actor, input, async children => {
      for (const child of new Map(children.map(booking => [booking.service.oplocId, booking])).values()) await assertHospitalityBookingMutationAccess(repository, principal, child, actor.role === "integration-admin" || actor.role === "reviewer");
    }, "customer-cancellation");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
