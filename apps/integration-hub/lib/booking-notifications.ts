import type { CanonicalBooking } from "./hospitality-booking-service";
import { renderBookingEmail } from "./booking-email-template";
import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";
import { isHotForkBuffetBooking } from "../../shared/hot-fork-buffet";

export type BookingNotificationKind = "submitted" | "confirmed" | "amended" | "cancelled";
export type BuffetNotificationKind = "buffet-handoff" | "buffet-change" | "buffet-cancellation";
export type BookingMessageKind = BookingNotificationKind | BuffetNotificationKind;
/** Supplied by the authenticated server entry point, never by the request body. */
export type CancellationEvent = "customer-cancellation" | "internal-reconciliation";

export function cancellationNotificationKind(booking: CanonicalBooking, event: CancellationEvent): "cancelled" | undefined {
  // Queue only the launched customer-facing event. The existing delivery worker
  // independently enforces the governed OPLOC allowlist and historical exclusions.
  return event === "customer-cancellation" && booking.service.portalSiteId === "rcoa" ? "cancelled" : undefined;
}
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
export type BookingNotificationRecord = Omit<BookingEmail, "kind"> & { kind: BookingMessageKind; notificationId: string; bookingId: string; status: "queued" | "sent" | "failed"; createdAt: string; attempts: number; sentAt?: string; failedAt?: string; failureReason?: string; bookingVersion?: number; commercialVersion?: number; oplocId?: string; /** Set on consolidated group notifications; bookingId is the anchor service. */ bookingGroupId?: string; groupBookingIds?: string[]; delivery?: import("@fika/server-shared/durable-outbox").DurableEventDelivery; outboxStatus?: string; nextEligibleAt?: string; gmailMessageId?: string; sendingStartedAt?: string; testFixture?: boolean; sourceReference?: string };

export function bookingNotificationId(booking: CanonicalBooking, kind: BookingNotificationKind, version: number) {
  return `booking:${booking.canonicalId}:${kind}:${version}`.replace(/[^A-Za-z0-9:_-]/g, "_");
}

export function bookingNotificationRecord(booking: CanonicalBooking, kind: BookingNotificationKind, version: number, createdAt: string): BookingNotificationRecord {
  const siteId = booking.service.portalSiteId || "mnk";
  const siteLabel = booking.service.portalSiteLabel || siteId;
  return { ...buildBookingEmail(kind, booking), siteId, siteLabel, templateKey: `${siteId}.${kind}.v3`, notificationId: bookingNotificationId(booking, kind, version), bookingId: booking.canonicalId, bookingVersion: version, commercialVersion: booking.commercialVersion || 1, ...(booking.service.oplocId ? { oplocId: booking.service.oplocId } : {}), status: "queued", createdAt, attempts: 0, delivery: { status: "pending", attempts: 0 }, outboxStatus: "pending", nextEligibleAt: createdAt };
}

const htmlEscape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function buffetNotificationRecord(booking: CanonicalBooking, kind: BuffetNotificationKind, version: number, createdAt: string, sourceReference: string, previousBooking?: CanonicalBooking): BookingNotificationRecord {
  if (!isHotForkBuffetBooking(booking)) throw new Error("Buffet notification requires a Hot Fork Buffet booking.");
  const base = process.env.FIKA_APP_HOSPITALITY_URL?.trim();
  let bookingLink: string | undefined;
  if (base) {
    const origin = approvedCredentialedUpstream("hospitality", base);
    const bookingUrl = new URL("/manage", origin); bookingUrl.searchParams.set("bookingId", booking.canonicalId); bookingLink = bookingUrl.toString();
  }
  const clientName = booking.client.companyName || booking.client.clientName || booking.client.requester?.name || "Client";
  const siteName = booking.service.portalSiteLabel || booking.service.portalSiteId || booking.service.oplocId || "Site to confirm";
  const subject = kind === "buffet-handoff" ? `Hot Fork Buffet sent to CPU · ${booking.service.eventDate} · ${clientName}` : kind === "buffet-cancellation" ? `Hot Fork Buffet cancellation · ${booking.service.eventDate} · ${clientName}` : `Hot Fork Buffet booking changed · ${booking.service.eventDate} · ${clientName}`;
  const changes = previousBooking ? ([
    ["Booking date", previousBooking.service.eventDate, booking.service.eventDate],
    ["Service time", previousBooking.service.startTime, booking.service.startTime],
    ["Guest count", previousBooking.service.guestCount, booking.service.guestCount],
    ["Site / OPLOC", `${previousBooking.service.portalSiteLabel || previousBooking.service.oplocId || "unmapped"} (${previousBooking.service.oplocId || "unmapped"})`, `${siteName} (${booking.service.oplocId || "unmapped"})`],
  ] as const).filter(([, before, after]) => String(before ?? "") !== String(after ?? "")) : [];
  const lines = ["Hot Fork Buffet booking update", `Booking date: ${booking.service.eventDate}`, `Service time: ${booking.service.startTime}`, `Site / OPLOC: ${siteName} (${booking.service.oplocId || "unmapped"})`, `Client: ${clientName}`, `Guest count: ${booking.service.guestCount}`, `Booking reference: ${booking.source.sourceBookingId}`, `Booking ID: ${booking.canonicalId}`, ...changes.map(([label, before, after]) => `Changed ${label.toLowerCase()}: ${before} → ${after}`), ...(bookingLink ? [`Booking link: ${bookingLink}`] : []), `Update: ${kind.replaceAll("-", " ")}`];
  return { kind, to: [], cc: [], subject, text: lines.join("\n"), html: `<h2>Hot Fork Buffet booking update</h2><dl>${[["Booking date", booking.service.eventDate], ["Service time", booking.service.startTime], ["Site / OPLOC", `${siteName} (${booking.service.oplocId || "unmapped"})`], ["Client", clientName], ["Guest count", booking.service.guestCount], ["Booking reference", booking.source.sourceBookingId]].map(([label, value]) => `<dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd>`).join("")}</dl>${changes.length ? `<p><strong>Approved changes</strong></p><ul>${changes.map(([label, before, after]) => `<li>${htmlEscape(label)}: ${htmlEscape(before)} → ${htmlEscape(after)}</li>`).join("")}</ul>` : ""}<p>${htmlEscape(kind.replaceAll("-", " "))}</p>${bookingLink ? `<p><a href="${htmlEscape(bookingLink)}">Open booking</a></p>` : ""}`, notificationId: `booking:${booking.canonicalId}:${kind}:v${version}`, bookingId: booking.canonicalId, status: "queued", createdAt, attempts: 0, bookingVersion: version, commercialVersion: booking.commercialVersion || 1, ...(booking.service.oplocId ? { oplocId: booking.service.oplocId } : {}), sourceReference, delivery: { status: "pending", attempts: 0 }, outboxStatus: "pending", nextEligibleAt: createdAt };
}

export function configuredRecipients(siteId?: string) {
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
