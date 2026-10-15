/** Hospitality quote entry point: resolves the current immutable revision and renders it with the canonical shared quote document. */
import type { CanonicalBooking } from "@/lib/canonical-types";
import { renderHospitalityQuoteDocument, type QuoteDocumentCharge, type QuoteDocumentLine, type QuoteDocumentSnapshot } from "../../shared/hospitality-quote-document";

type Money = { amount: number; currency?: string };
type QuoteLine = QuoteDocumentLine;
type QuoteCommercialSnapshot = { bookingId: string; client: CanonicalBooking["client"]; service: CanonicalBooking["service"]; order: { eventType?: string; lines: QuoteLine[] }; charges: Array<QuoteDocumentCharge & { sourceAdditionalChargeId?: string; category?: string; labour?: { roleId?: string; roleLabel: string; staffCount: number; hoursPerPerson: number; hourlyRate: number; multiplier: number; rateSource: "governed" | "configured" | "custom" } }>; totals: { itemsNet: Money; chargesNet: Money; net: Money; vat: Money; gross: Money; vatRate: number }; dietaries: Record<string, unknown>; notes?: string };

function fallbackSnapshot(booking: CanonicalBooking): QuoteCommercialSnapshot {
  const lines = booking.order.items.map(item => ({ itemId: item.itemId, name: item.itemName || item.itemId, description: item.description, quantity: item.quantity, unitNet: { amount: item.unitPrice }, lineNet: { amount: item.lineTotal ?? Math.round(item.quantity * item.unitPrice * 100) / 100 }, servingInfo: item.servingInfo, choices: item.choices, comments: item.comments }));
  const items = lines.reduce((sum, line) => sum + line.lineNet.amount, 0); const charges = booking.deliveryChargeRequired ? [{ label: "CPU delivery charge", net: { amount: 35 } }] : []; const chargesNet = charges.reduce((sum, charge) => sum + charge.net.amount, 0); const net = items + chargesNet; const vat = Math.round(net * 0.2 * 100) / 100;
  return { bookingId: booking.canonicalId, client: booking.client, service: booking.service, order: { eventType: booking.order.eventType, lines }, charges, totals: { itemsNet: { amount: items }, chargesNet: { amount: chargesNet }, net: { amount: net }, vat: { amount: vat }, gross: { amount: net + vat }, vatRate: 0.2 }, dietaries: booking.dietaries, notes: booking.notes };
}

export function quoteHtml(booking: CanonicalBooking) {
  const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
  if (!quote || quote.stale) throw new Error("No current quote revision is available.");
  const raw = quote.snapshot as Partial<QuoteCommercialSnapshot> & Pick<CanonicalBooking, "client" | "service" | "order" | "dietaries" | "notes">;
  const snapshot = raw.totals && raw.charges && raw.order?.lines ? raw as QuoteCommercialSnapshot : fallbackSnapshot(booking);
  return renderHospitalityQuoteDocument(snapshot as QuoteDocumentSnapshot, { createdAt: quote.createdAt });
}
