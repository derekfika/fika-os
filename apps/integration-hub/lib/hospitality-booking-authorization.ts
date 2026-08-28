import type { AuthPrincipal, AuthModRepository } from "./authmod-core";
import { resolveUserAccess } from "./authmod-core/evaluator";
import type { CanonicalBooking } from "./hospitality-booking-service";

export async function assertHospitalityBookingMutationAccess(
  repository: AuthModRepository,
  principal: AuthPrincipal,
  booking: Pick<CanonicalBooking, "service">,
  elevated = false,
) {
  if (elevated) return;
  const oplocId = String(booking.service?.oplocId || "").trim();
  if (!oplocId) throw Object.assign(new Error("This Booking has no governed service OPLOC."), { status: 403 });
  const decision = await resolveUserAccess(repository, {
    principal,
    appId: "hospitality-booking",
    oplocId,
  });
  if (!decision.allowed) throw Object.assign(new Error("You are not authorised to change this Hospitality Booking."), { status: 403, code: "AUTHMOD_HOSPITALITY_BOOKING_DENIED", decision });
}
