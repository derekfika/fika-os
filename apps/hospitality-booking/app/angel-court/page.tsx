import BookingPortal from "../ui/BookingPortal";
import { portalSite } from "../../lib/portal-sites";

export default function AngelCourtBookingPage() {
  return <BookingPortal siteKey="angel-court" oplocId={portalSite("angel-court").canonicalOplocId} />;
}
