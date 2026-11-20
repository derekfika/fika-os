import BookingPortal from "../ui/BookingPortal";
import { portalSite } from "../../lib/portal-sites";
import { studioPortalPilot } from "../../lib/studio-portal-pilot";

export default function MnkBookingPage() {
  const pilot = studioPortalPilot();
  return <BookingPortal siteKey="mnk" oplocId={pilot?.oplocId ?? portalSite("mnk").canonicalOplocId}
    studioPilotDates={pilot ? { firstDate: pilot.firstDate, lastDate: pilot.lastDate } : undefined} />;
}
