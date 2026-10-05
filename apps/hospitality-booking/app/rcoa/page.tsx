import RcoaBookingPortal from "../ui/RcoaBookingPortal";

export const dynamic = "force-dynamic";

export default function RcoaBookingPage() {
  return <RcoaBookingPortal oplocId={process.env.FIKA_RCOA_OPLOC_ID?.trim()} />;
}
