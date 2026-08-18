import type { CanonicalBooking } from "./hospitality-booking-service";

export type BookingNotificationKind = "submitted" | "confirmed" | "cancelled";
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
export type BookingNotificationRecord = BookingEmail & { notificationId: string; bookingId: string; status: "queued" | "sent" | "failed"; createdAt: string; attempts: number; sentAt?: string; failedAt?: string; failureReason?: string };

export function bookingNotificationId(booking: CanonicalBooking, kind: BookingNotificationKind, version: number) {
  return `booking:${booking.canonicalId}:${kind}:${version}`.replace(/[^A-Za-z0-9:_-]/g, "_");
}

export function bookingNotificationRecord(booking: CanonicalBooking, kind: BookingNotificationKind, version: number, createdAt: string): BookingNotificationRecord {
  const siteId = booking.service.portalSiteId || "mnk";
  const siteLabel = booking.service.portalSiteLabel || siteId;
  return { ...buildBookingEmail(kind, booking), siteId, siteLabel, templateKey: `${siteId}.${kind}.v1`, notificationId: bookingNotificationId(booking, kind, version), bookingId: booking.canonicalId, status: "queued", createdAt, attempts: 0 };
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function date(value: string) {
  const parts = String(value || "").split("-");
  if (parts.length !== 3) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
}

function eventType(booking: CanonicalBooking) {
  return booking.order.eventType || "Hospitality";
}

function location(booking: CanonicalBooking) {
  return [booking.service.portalSiteLabel || "MNK", booking.service.floorLevel || booking.service.roomOrArea || booking.service.deliveryPoint].filter(Boolean).join(" · ");
}

function siteLabel(booking: CanonicalBooking) {
  return booking.service.portalSiteLabel || booking.service.portalSiteId || "MNK";
}

function items(booking: CanonicalBooking) {
  if (!booking.order.items.length) return "No itemised order details were available for this booking.";
  return booking.order.items.map(item => `${item.quantity} x ${item.itemName || item.itemId}${item.servingInfo ? ` — ${item.servingInfo}` : ""}${item.comments ? ` — ${item.comments}` : ""}`).join("\n");
}

function itemHtml(booking: CanonicalBooking) {
  if (!booking.order.items.length) return `<p style="margin:0;color:#6B627A;">No itemised order details were available for this booking.</p>`;
  return `<div style="border:1px solid #E4DEEF;border-radius:16px;overflow:hidden;">${booking.order.items.map((item, index) => `<div style="padding:15px 16px;${index ? "border-top:1px solid #E4DEEF;" : ""}"><div style="font-weight:700;color:#241F33;">${esc(`${item.quantity} x ${item.itemName || item.itemId}`)}</div>${item.servingInfo ? `<div style="margin-top:4px;color:#6B627A;font-size:13px;">${esc(item.servingInfo)}</div>` : ""}${item.comments ? `<div style="margin-top:8px;color:#4A4358;font-size:13px;">${esc(item.comments)}</div>` : ""}</div>`).join("")}</div>`;
}

function plainFromHtml(html: string) {
  return html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/((p|div|h[1-6]))>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

function configuredRecipients() {
  const value = process.env.FIKA_MNK_NOTIFICATION_RECIPIENTS || process.env.FIKA_BOOKING_NOTIFICATION_RECIPIENTS || "mnk@fikacatering.com";
  return [...new Set(value.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

export function buildBookingSubmittedEmail(booking: CanonicalBooking): BookingEmail {
  const recipients = configuredRecipients();
  const subject = booking.service.portalSiteId
    ? `New FIKA Hospitality booking request | ${siteLabel(booking)} | ${booking.service.eventDate} | ${booking.client.companyName}`
    : `New Fika at MNK Hospitality booking request | ${booking.service.eventDate} | ${booking.client.companyName}`;
  const lines = [
    `A new booking request has been added to the ${siteLabel(booking)} hospitality dashboard.`, "",
    `Reference: ${booking.source.sourceBookingId}`, `Company: ${booking.client.companyName}`, `Contact: ${booking.client.name}`, `Contact email: ${booking.client.email}`, `Contact phone: ${booking.client.phone || ""}`,
    `Event: ${eventType(booking)}`, `Date: ${booking.service.eventDate}`, `Time: ${booking.service.startTime}${booking.service.endTime ? ` - ${booking.service.endTime}` : ""}`, `Guests: ${booking.service.guestCount}`, `Floor / area: ${booking.service.floorLevel || booking.service.roomOrArea || ""}`, `Estimated total: GBP ${Number(booking.order.netTotal || 0).toFixed(2)}`, "Dashboard status: New", "", "Please review the request and prepare the quote."
  ];
  const rows = [["Reference", booking.source.sourceBookingId], ["Company", booking.client.companyName], ["Contact", booking.client.name], ["Contact email", booking.client.email], ["Contact phone", booking.client.phone || ""], ["Event", eventType(booking)], ["Date", booking.service.eventDate], ["Time", `${booking.service.startTime}${booking.service.endTime ? ` - ${booking.service.endTime}` : ""}`], ["Guests", booking.service.guestCount], ["Floor / area", booking.service.floorLevel || booking.service.roomOrArea || ""], ["Estimated total", `GBP ${Number(booking.order.netTotal || 0).toFixed(2)}`], ["Dashboard status", "New"]];
  const html = `<div style="font-family:Arial,sans-serif;color:#07506f;max-width:620px"><div style="background:#176f8e;color:#fff;padding:24px 28px"><div style="font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">Hospitality brochure 2026</div><h1 style="font-size:26px;margin:8px 0 0">New Fika at MNK Hospitality booking</h1></div><div style="padding:26px 28px;border:1px solid #c7dfe8;border-top:0"><p style="margin-top:0;color:#4d7890">A new client booking request is ready for review.</p><table style="width:100%;border-collapse:collapse">${rows.map(row => `<tr><td style="padding:9px 8px;border-bottom:1px solid #e4f1f5;color:#4d7890">${esc(row[0])}</td><td style="padding:9px 8px;border-bottom:1px solid #e4f1f5;text-align:right;font-weight:bold">${esc(row[1])}</td></tr>`).join("")}</table><p style="font-size:12px;color:#4d7890;margin-bottom:0">Please review the request and prepare the quote.</p></div></div>`;
  return { kind: "submitted", to: recipients, cc: [], subject, text: lines.join("\n"), html };
}

export function buildBookingConfirmedEmail(booking: CanonicalBooking): BookingEmail {
  const html = `<div style="margin:0;padding:0;background:#F8F6FF;font-family:Arial,Helvetica,sans-serif;color:#241F33;line-height:1.5"><div style="max-width:680px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #DDD8EA;border-radius:22px;overflow:hidden"><div style="padding:28px 30px;background:#4F34C7;color:#fff"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.9">FIKA Hospitality</div><h1 style="margin:8px 0 0;font-size:30px;line-height:1.1">Booking confirmed</h1><p style="margin:10px 0 0;font-size:15px">Fika at MNK Hospitality - ${esc(date(booking.service.eventDate))}</p></div><div style="padding:28px 30px"><p style="margin:0 0 14px">Hi ${esc(booking.client.name)},</p><p style="margin:0 0 18px">Your hospitality booking is confirmed and scheduled with our team. Here is a summary of what we have booked in for you.</p><div style="margin:22px 0;padding:18px;border:1px solid #E4DEEF;border-radius:16px;background:#FBFAFF"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px">${[["Reference", booking.source.sourceBookingId], ["Client", booking.client.companyName], ["Service", eventType(booking)], ["Date", date(booking.service.eventDate)], ["Time", booking.service.startTime], ["Location", location(booking)], ["Guests", booking.service.guestCount]].map(row => `<tr><td style="padding:6px 0;color:#6B627A">${esc(row[0])}</td><td style="padding:6px 0;text-align:right;font-weight:700">${esc(row[1])}</td></tr>`).join("")}</table></div><h2 style="margin:24px 0 12px;color:#4F34C7;font-size:20px">Your booked items</h2>${itemHtml(booking)}<div style="margin:24px 0 0;padding:16px;border-left:4px solid #FF5C00;background:#FFF8F4;border-radius:12px"><p style="margin:0;font-size:14px">No prices are shown here because this is a booking confirmation, not a quote. Labour, equipment hire, VAT or event-specific requirements may be confirmed separately where needed.</p></div><p style="margin:24px 0 0">If anything needs changing before the service date, please let us know as soon as possible and we will do our best to help.</p><p style="margin:24px 0 0">Kind regards,<br><strong style="color:#4F34C7">FIKA Hospitality</strong></p></div></div></div></div>`;
  return { kind: "confirmed", to: booking.client.email ? [booking.client.email] : [], cc: [], subject: `FIKA Hospitality | ${siteLabel(booking)} | Booking Confirmed | ${date(booking.service.eventDate)}`, text: plainFromHtml(html), html };
}

export function buildBookingCancelledEmail(booking: CanonicalBooking): BookingEmail {
  const html = `<div style="font-family:Arial,sans-serif;color:#241F33;line-height:1.5;padding:24px"><h2 style="color:#FF5C00;margin-bottom:8px">Booking Cancelled</h2><p>Hi there,</p><p>This email is to confirm that the following FIKA Hospitality booking has been cancelled.</p><div style="margin:22px 0;padding:18px;border:1px solid #DDD8EA;border-radius:14px;background:#FFF7F2"><p><strong>Booking Reference:</strong> ${esc(booking.source.sourceBookingId)}</p><p><strong>Service:</strong> ${esc(eventType(booking))}</p><p><strong>Date:</strong> ${esc(date(booking.service.eventDate))}</p><p><strong>Time:</strong> ${esc(booking.service.startTime)}</p><p><strong>Location:</strong> ${esc(location(booking))}</p></div><p>If you have any questions, please contact the FIKA Hospitality team.</p><p>Kind regards,<br><strong>FIKA Hospitality</strong></p></div>`;
  return { kind: "cancelled", to: booking.client.email ? [booking.client.email] : [], cc: [], subject: `FIKA Hospitality | ${siteLabel(booking)} | Booking Cancelled | ${date(booking.service.eventDate)}`, text: plainFromHtml(html), html };
}

export function buildBookingEmail(kind: BookingNotificationKind, booking: CanonicalBooking) {
  return kind === "submitted" ? buildBookingSubmittedEmail(booking) : kind === "confirmed" ? buildBookingConfirmedEmail(booking) : buildBookingCancelledEmail(booking);
}
