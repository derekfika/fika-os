import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { assertHospitalityBookingMutationAccess } from "@/lib/hospitality-booking-authorization";
import { setHospitalityGroupServiceCharges } from "@/lib/hospitality-booking-service";
import { groupChargesCommand } from "@/lib/hospitality-group-amendment";
import { groupCommercialState } from "@/lib/hospitality-group-commercial";
import { errorResponse } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    const session = await requireFikaSession(request);
    const input = groupChargesCommand.parse(await request.json());
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const result = await setHospitalityGroupServiceCharges(actor, input, async children => {
      for (const child of new Map(children.map(b => [b.service.oplocId, b])).values()) await assertHospitalityBookingMutationAccess(repository, principal, child, actor.role === "integration-admin" || actor.role === "reviewer");
    });
    return NextResponse.json({ booking: result.booking, changed: result.changed, sourceHash: groupCommercialState(input.bookingGroupId, result.bookings).sourceHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
