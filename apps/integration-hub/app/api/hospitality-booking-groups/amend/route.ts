import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { assertHospitalityBookingMutationAccess } from "@/lib/hospitality-booking-authorization";
import { amendHospitalityBookingGroup, getHospitalityBookingGroup } from "@/lib/hospitality-booking-service";
import { groupAmendmentCommand } from "@/lib/hospitality-group-amendment";
import { groupCommercialState } from "@/lib/hospitality-group-commercial";
import { errorResponse } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    const session = await requireFikaSession(request);
    const input = groupAmendmentCommand.parse(await request.json());
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const result = await amendHospitalityBookingGroup(actor, input, async children => {
      for (const child of new Map(children.map(b => [b.service.oplocId, b])).values()) await assertHospitalityBookingMutationAccess(repository, principal, child, actor.role === "integration-admin" || actor.role === "reviewer");
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    const session = await requireFikaSession(request);
    const id = groupAmendmentCommand.shape.bookingGroupId.parse(request.nextUrl.searchParams.get("bookingGroupId"));
    const children = await getHospitalityBookingGroup(id);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const repository = new FirestoreAuthModRepository();
    for (const child of new Map(children.map(b => [b.service.oplocId, b])).values()) await assertHospitalityBookingMutationAccess(repository, principal, child, actor.role === "integration-admin" || actor.role === "reviewer");
    return NextResponse.json({ bookings: children, sourceHash: groupCommercialState(id, children).sourceHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
