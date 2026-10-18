export const RCOA_BOOKING_SUBMISSIONS_DISABLED_MESSAGE =
  "The RCoA catalogue is available to browse, but booking submissions are not yet open.";

/** Booking submission is opt-in; absent, malformed, or any value other than exactly "true" stays closed. */
export function areRcoaBookingSubmissionsEnabled(
  value = process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED,
): boolean {
  return value === "true";
}
