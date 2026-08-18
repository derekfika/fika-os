/** Client-side façade over the shared FIKA OS quote document renderer.
 * The document itself is driven only by the immutable QuoteRevision snapshot. */
import { calculateQuoteSnapshot, compactBrandedQuoteDocumentHtml, defaultDashboardQuoteSettings } from "../../integration-hub/lib/quote-engine";
import type { CanonicalBooking } from "../../integration-hub/lib/hospitality-booking-service";
import type { QuoteCommercialSnapshot } from "../../integration-hub/lib/quote-engine";

export function quoteHtml(booking: CanonicalBooking) {
  const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
  if (!quote || quote.stale) throw new Error("No current quote revision is available.");
  const raw = quote.snapshot as Partial<QuoteCommercialSnapshot> & Pick<CanonicalBooking, "client" | "service" | "order" | "dietaries" | "notes">;
  const snapshot = raw.totals ? raw as QuoteCommercialSnapshot : calculateQuoteSnapshot({ canonicalId: booking.canonicalId, client: raw.client, service: raw.service, order: raw.order, dietaries: raw.dietaries || {}, notes: raw.notes, deliveryChargeRequired: booking.deliveryChargeRequired }, defaultDashboardQuoteSettings("mnk-hospitality"));
  const logoUrl = typeof window === "undefined" ? undefined : `${window.location.origin}/api/brand-assets/fika-logo-white.png`;
  return compactBrandedQuoteDocumentHtml(snapshot, { id: quote.id, revision: quote.revision, createdAt: quote.createdAt }, logoUrl);
}
