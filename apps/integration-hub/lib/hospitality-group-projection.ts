import type { CanonicalBooking } from "./hospitality-booking-service";
import { projectBookingGroup } from "./hospitality-group-commercial";
import { groupQuoteHeadsAndLatest } from "./hospitality-group-quote-store";
import type { GroupQuoteHead, HospitalityGroupQuote } from "./hospitality-group-quote-workflow";
import type { HospitalityBookingGroup, HospitalityGroupService } from "../../shared/hospitality-group-quotes";

export async function hospitalityGroupProjection(bookings: CanonicalBooking[], routing: Record<string, HospitalityGroupService["routing"]>, production: Record<string, HospitalityGroupService["production"]> = {}) {
  const ids = [...new Set(bookings.flatMap(b => b.bookingGroup?.id ? [b.bookingGroup.id] : []))];
  return projectHospitalityGroups(bookings, await groupQuoteHeadsAndLatest(ids), routing, production);
}

export function projectHospitalityGroups(bookings: CanonicalBooking[], latest: Array<{ head: GroupQuoteHead; quote?: HospitalityGroupQuote }>, routing: Record<string, HospitalityGroupService["routing"]> = {}, production: Record<string, HospitalityGroupService["production"]> = {}) {
  const candidates = new Map<string, CanonicalBooking[]>();
  for (const booking of bookings) if (booking.bookingGroup?.id) candidates.set(booking.bookingGroup.id, [...(candidates.get(booking.bookingGroup.id) || []), booking]);
  const states = new Map(latest.map(s => [s.head.bookingGroupId, s]));
  const bookingGroups: HospitalityBookingGroup[] = [];
  const groupedIds = new Set<string>();
  const groupWarnings: Array<{ bookingGroupId: string; message: string }> = [];
  for (const [id, children] of candidates) {
    try {
      const state = states.get(id);
      bookingGroups.push(projectBookingGroup(id, children, state?.quote, state?.head.version, routing, production));
      children.forEach(child => groupedIds.add(child.canonicalId));
    } catch (error) {
      // Incomplete/truncated/malformed historical groups remain visible as services and cannot generate a consolidated quote.
      groupWarnings.push({ bookingGroupId: id, message: error instanceof Error ? error.message : "Invalid booking group." });
    }
  }
  return { bookingGroups, dashboardBookings: bookings.filter(b => !groupedIds.has(b.canonicalId)), ...(groupWarnings.length ? { groupWarnings } : {}) };
}
