import BookingPortal from "../../ui/BookingPortal";
import { portalSite } from "../../../lib/portal-sites";

export default function HospitalityMnkPage() {
  return <BookingPortal siteKey="mnk" oplocId={portalSite("mnk").canonicalOplocId} />;
}
