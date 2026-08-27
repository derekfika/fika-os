import BookingPortal from "../ui/BookingPortal";
import { portalSite } from "../../lib/portal-sites";

export default function MnkBookingPage() {
  return <BookingPortal siteKey="mnk" oplocId={portalSite("mnk").canonicalOplocId} />;
}
