import type { CanonicalBooking } from "../../lib/canonical-types";
import styles from "./ProductionReplacementNotice.module.css";

export function ProductionReplacementNotice({ booking, serviceLabel }: { booking: CanonicalBooking; serviceLabel?: string }) {
  if (booking.lifecycleStatus === "Cancelled" || booking.dashboardWorkflow?.productionReplacement?.status !== "send_to_cpu_required") return null;
  return <div className={styles.notice} role="status"><strong>{serviceLabel ? `${serviceLabel}: replacement required` : "Replacement CPU order required"}</strong><p>The previous CPU order was retired after this buffet booking changed. Generate the current quote, then use Send to CPU to create the replacement. It has not been sent automatically.</p></div>;
}
