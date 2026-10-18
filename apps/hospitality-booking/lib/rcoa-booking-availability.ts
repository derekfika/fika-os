export const RCOA_BOOKING_SUBMISSIONS_DISABLED_MESSAGE =
  "The RCoA catalogue is available to browse, but booking submissions are not yet open.";

/** Production booking submission is opt-in; absent, malformed, or false values remain disabled. */
export function areRcoaBookingSubmissionsEnabled(
  value = process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED,
): boolean {
  return value === "true";
}
