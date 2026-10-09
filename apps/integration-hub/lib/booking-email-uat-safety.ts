import type { BookingNotificationRecord } from "./booking-notifications";

/** Staging mail is an explicit operator UAT, restricted by stable Booking IDs. */
export function assertStagingEmailCandidate(message: BookingNotificationRecord, env: Record<string, string | undefined> = process.env) {
  if (env.FIKA_RUNTIME_MODE !== "staging") return;
  const bookingIds = (env.FIKA_HOSPITALITY_EMAIL_UAT_BOOKING_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
  const recipient = env.FIKA_HOSPITALITY_EMAIL_UAT_RECIPIENT?.trim().toLowerCase();
  const recipients = [...message.to, ...message.cc];
  if (!recipient || !bookingIds.includes(message.bookingId) || !message.to.length || recipients.some(value => value.trim().toLowerCase() !== recipient)) {
    throw new Error("Staging email candidate is outside the explicit UAT booking/recipient scope; no email sent.");
  }
}
