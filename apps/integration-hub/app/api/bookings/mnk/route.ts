import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { ingestMnkBooking } from "@/lib/hospitality-booking-service";
import { requireBridgeAccess } from "@/lib/hospitality-bridge-auth";
import { FirestoreAuthModRepository } from "@/lib/authmod-core/firestore-repository";
import { requireBoundFikaSession } from "@/lib/fika-session";
import { requireCompanyHospitalityBookingAdmin } from "@/lib/hospitality-booking-authorization";
import { studioPilot } from "@/lib/hospitality-studio-pilot";

const Payload = z.object({ bookingId: z.string().min(1).max(240), bookingGroup: z.object({ id: z.string().min(1).max(240), sequence: z.number().int().min(1).max(20), size: z.number().int().min(1).max(20) }).strict().refine((group) => group.sequence <= group.size, "sequence must not exceed size").optional(), submittedAt: z.string().datetime(), status: z.string().optional(), site: z.string().optional(), siteId: z.string().optional(), client: z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional(), companyName: z.string().min(1), requester: z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional(), companyName: z.string().min(1) }).optional(), clientName: z.string().min(1).optional(), clientCompany: z.string().min(1).optional(), invoiceReference: z.string().optional() }), event: z.object({ eventDate: z.string().date(), startTime: z.string().min(1), endTime: z.string().optional(), guestCount: z.number().positive(), floorLevel: z.string().optional(), roomOrArea: z.string().optional(), deliveryPoint: z.string().optional(), onsiteContactName: z.string().optional(), onsiteContactPhone: z.string().optional() }), order: z.object({ eventType: z.string().optional(), items: z.array(z.object({ itemId: z.string().min(1), itemName: z.string().optional(), category: z.string().optional(), description: z.string().optional(), servingInfo: z.string().optional(), unitPrice: z.number(), quantity: z.number().positive(), lineTotal: z.number(), choices: z.array(z.unknown()).optional(), comments: z.string().optional() })), netTotal: z.number(), vatNote: z.string().optional() }), dietaries: z.record(z.string(), z.unknown()).optional(), acknowledgements: z.record(z.string(), z.unknown()).optional(), specialInstructions: z.string().optional() }).strict();
export async function POST(request: NextRequest) {
  try {
    requireBridgeAccess(request);
    const payload = Payload.parse(await request.json());
    const expectedRcoaOplocId = request.headers.get("x-fika-expected-rcoa-oploc-id")?.trim();
    const result = await ingestMnkBooking(payload, expectedRcoaOplocId, request.headers.get("x-fika-rcoa-existing-only") === "true", async transaction => {
      if (!studioPilot() || process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ENABLED !== "true") {
        throw Object.assign(new Error("Studio pilot booking is disabled."), { status: 403 });
      }
      const repository = new FirestoreAuthModRepository("studio-pilot-booking", undefined, transaction);
      const session = await requireBoundFikaSession(request, repository);
      if (!process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ACTOR_ID || session.authmodIdentityId !== process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ACTOR_ID) {
        throw Object.assign(new Error("This operator is outside the approved Studio booking scope."), { status: 403 });
      }
      await requireCompanyHospitalityBookingAdmin(repository, { type: "interactive", id: session.authmodIdentityId, displayName: session.displayName });
      return session.authmodIdentityId;
    });
    return NextResponse.json({ canonicalBookingId: result.booking.canonicalId, status: result.booking.lifecycleStatus, created: result.created, validationWarnings: result.validationWarnings });
  } catch (error) { return errorResponse(error); }
}
