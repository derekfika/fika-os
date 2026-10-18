import RcoaBookingPortal from "../ui/RcoaBookingPortal";

export const dynamic = "force-dynamic";

export default function RcoaBookingPage() {
  return (
    <RcoaBookingPortal
      configured={Boolean(process.env.FIKA_RCOA_OPLOC_ID?.trim())}
      bookingSubmissionsEnabled={process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED === "true"}
    />
  );
}
