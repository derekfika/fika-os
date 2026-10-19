import type { CanonicalBooking } from "./hospitality-booking-service";
import { renderBookingEmail } from "./booking-email-template";

export type BookingNotificationKind = "submitted" | "confirmed" | "amended" | "cancelled";
export type BookingEmail = {
  kind: BookingNotificationKind;
  siteId?: string;
  siteLabel?: string;
  templateKey?: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
};
export type BookingNotificationRecord = BookingEmail & { notificationId: string; bookingId: string; status: "queued" | "sent" | "failed"; createdAt: string; attempts: number; sentAt?: string; failedAt?: string; failureReason?: string; bookingVersion?: number; commercialVersion?: number; oplocId?: string; delivery?: import("@fika/server-shared/durable-outbox").DurableEventDelivery; outboxStatus?: string; nextEligibleAt?: string; gmailMessageId?: string; sendingStartedAt?: string; testFixture?: boolean };

export function bookingNotificationId(booking: CanonicalBooking, kind: BookingNotificationKind, version: number) {
  return `booking:${booking.canonicalId}:${kind}:${version}`.replace(/[^A-Za-z0-9:_-]/g, "_");
}

export function bookingNotificationRecord(booking: CanonicalBooking, kind: BookingNotificationKind, version: number, createdAt: string): BookingNotificationRecord {
  const siteId = booking.service.portalSiteId || "mnk";
  const siteLabel = booking.service.portalSiteLabel || siteId;
  return { ...buildBookingEmail(kind, booking), siteId, siteLabel, templateKey: `${siteId}.${kind}.v3`, notificationId: bookingNotificationId(booking, kind, version), bookingId: booking.canonicalId, bookingVersion: version, commercialVersion: booking.commercialVersion || 1, ...(booking.service.oplocId ? { oplocId: booking.service.oplocId } : {}), status: "queued", createdAt, attempts: 0, delivery: { status: "pending", attempts: 0 }, outboxStatus: "pending", nextEligibleAt: createdAt };
}

function configuredRecipients(siteId?: string) {
  const value = siteId === "rcoa"
    ? process.env.FIKA_RCOA_NOTIFICATION_RECIPIENTS || process.env.FIKA_BOOKING_NOTIFICATION_RECIPIENTS || ""
    : siteId && siteId !== "mnk" ? process.env[`FIKA_${siteId.replace(/-/g, "_").toUpperCase()}_NOTIFICATION_RECIPIENTS`] || "" : process.env.FIKA_MNK_NOTIFICATION_RECIPIENTS || process.env.FIKA_BOOKING_NOTIFICATION_RECIPIENTS || "mnk@fikacatering.com";
  return [...new Set(value.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

/** Customer-facing lifecycle emails share one branded template (see booking-email-template.ts). */
function branded(kind: BookingNotificationKind, booking: CanonicalBooking, to: string[], cc: string[]): BookingEmail {
  return { kind, to, cc, ...renderBookingEmail(kind, booking) };
}
const customer = (booking: CanonicalBooking) => booking.client.email ? [booking.client.email] : [];

export function buildBookingSubmittedEmail(booking: CanonicalBooking): BookingEmail {
  // RCoA customer notices are customer-only; no internal operations CC.
  return branded("submitted", booking, customer(booking), booking.service.portalSiteId === "rcoa" ? [] : configuredRecipients(booking.service.portalSiteId));
}
export const buildBookingConfirmedEmail = (booking: CanonicalBooking) => branded("confirmed", booking, customer(booking), []);
export const buildBookingAmendedEmail = (booking: CanonicalBooking) => branded("amended", booking, customer(booking), []);
export const buildBookingCancelledEmail = (booking: CanonicalBooking) => branded("cancelled", booking, customer(booking), []);

export function buildBookingEmail(kind: BookingNotificationKind, booking: CanonicalBooking): BookingEmail {
  return kind === "submitted" ? buildBookingSubmittedEmail(booking) : kind === "confirmed" ? buildBookingConfirmedEmail(booking) : kind === "amended" ? buildBookingAmendedEmail(booking) : buildBookingCancelledEmail(booking);
}
