/** Client-side façade over the shared FIKA OS quote document renderer.
 * The document itself is driven only by the immutable QuoteRevision snapshot. */
import type { CanonicalBooking } from "@/lib/canonical-types";

type QuoteCommercialSnapshot = { bookingId: string; client: CanonicalBooking["client"]; service: CanonicalBooking["service"]; order: { eventType?: string; lines: Array<{ name: string; quantity: number; lineNet: { amount: number } }> }; totals: { itemsNet: { amount: number }; chargesNet: { amount: number }; net: { amount: number }; vat: { amount: number }; gross: { amount: number }; vatRate: number }; dietaries: Record<string, unknown>; notes?: string };
function quoteSnapshot(booking: CanonicalBooking): QuoteCommercialSnapshot {
  const lines = booking.order.items.map(item => ({ name: item.itemName || item.itemId, quantity: item.quantity, lineNet: { amount: Math.round(item.quantity * item.unitPrice * 100) / 100 } }));
  const items = lines.reduce((sum, line) => sum + line.lineNet.amount, 0); const charges = booking.deliveryChargeRequired ? 35 : 0; const net = items + charges; const vat = net * 0.2;
  return { bookingId: booking.canonicalId, client: booking.client, service: booking.service, order: { eventType: booking.order.eventType, lines }, totals: { itemsNet: { amount: items }, chargesNet: { amount: charges }, net: { amount: net }, vat: { amount: vat }, gross: { amount: net + vat }, vatRate: 0.2 }, dietaries: booking.dietaries, notes: booking.notes };
}
function compactQuoteHtml(snapshot: QuoteCommercialSnapshot, reference: { id: string; revision: number; createdAt: string }, logoUrl?: string) { const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] || char)); const rows = snapshot.order.lines.map(line => `<tr><td>${esc(line.name)}</td><td>${line.quantity}</td><td>£${line.lineNet.amount.toFixed(2)}</td></tr>`).join(""); return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA quote ${esc(reference.id)}</title></head><body><h1>FIKA Hospitality Quotation</h1><p>${esc(snapshot.client.companyName)} · ${esc(snapshot.service.eventDate)} · ${snapshot.service.guestCount} guests</p><table><tbody>${rows}</tbody></table><p>Items £${snapshot.totals.itemsNet.amount.toFixed(2)} · Charges £${snapshot.totals.chargesNet.amount.toFixed(2)} · Total £${snapshot.totals.gross.amount.toFixed(2)}</p></body></html>`; }

export function quoteHtml(booking: CanonicalBooking) {
  const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
  if (!quote || quote.stale) throw new Error("No current quote revision is available.");
  const raw = quote.snapshot as Partial<QuoteCommercialSnapshot> & Pick<CanonicalBooking, "client" | "service" | "order" | "dietaries" | "notes">;
  const snapshot = raw.totals ? raw as QuoteCommercialSnapshot : quoteSnapshot(booking);
  const logoUrl = typeof window === "undefined" ? undefined : `${window.location.origin}/api/brand-assets/fika-logo-white.png`;
  return compactQuoteHtml(snapshot, { id: quote.id, revision: quote.revision, createdAt: quote.createdAt }, logoUrl);
}
