import { humaniseQuoteLabel } from "./quote-engine";
import type { HospitalityGroupQuote } from "./hospitality-group-quote-workflow";
import { groupHash } from "./hospitality-group-commercial";
import { quoteEsc as esc, quoteGbp as gbp, quoteOrderTableHtml, renderHospitalityQuoteDocument, type QuoteDocumentSnapshot } from "../../shared/hospitality-quote-document";

/**
 * Grouped (all-day) Hospitality quotation. The shell — masthead branding, typography, table, totals — is the canonical
 * Hospitality quote document shared with single-service quotes; only the time-ordered service sections are group-specific.
 */
export function hospitalityGroupQuoteHtml(q: HospitalityGroupQuote) {
  const first = q.snapshots[0];
  const commonNotes = (first.notes || "").split(/\n\n/).filter(note => note && !/^(Event:|Service note:|All Day Hospitality request )/.test(note) && q.snapshots.every(s => (s.notes || "").split(/\n\n/).includes(note)));
  const sharedDietaries = q.snapshots.every(s => groupHash(s.dietaries) === groupHash(first.dietaries));
  const lastTime = q.snapshots.flatMap(s => [s.service.startTime, s.service.endTime || s.service.startTime]).sort().at(-1)!;
  const summary = { ...first, notes: commonNotes.join("\n\n"), dietaries: sharedDietaries ? first.dietaries : { "Service requirements": "See service sections" }, service: { ...first.service, portalSiteLabel: first.service.portalSiteLabel || undefined, startTime: first.service.startTime, endTime: lastTime }, order: { eventType: "All Day Hospitality", lines: [] }, charges: [], totals: { ...first.totals, ...Object.fromEntries(Object.entries(q.totals).map(([key, amount]) => [key, { amount, currency: "GBP" as const }])) } } as QuoteDocumentSnapshot;
  const client = first.client as typeof first.client & { invoiceReference?: string };
  const eventName = first.notes?.match(/^Event: (.+)$/m)?.[1];
  const headerDetails = `<p>Request reference: ${esc(q.bookingGroupId)}</p>${eventName ? `<p>Event: ${esc(eventName)}</p>` : ""}${client.invoiceReference ? `<p>PO / reference: ${esc(client.invoiceReference)}</p>` : ""}`;
  const sections = q.snapshots.map(s => {
    const notes = (s.notes || "").split(/\n\n/).filter(note => note && !/^(Event:|All Day Hospitality request )/.test(note) && !commonNotes.includes(note));
    const details = `${notes.length ? `<p>${notes.map(esc).join("<br>")}</p>` : ""}${!sharedDietaries ? `<p>Dietary requirements: ${esc(Object.entries(s.dietaries).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "None recorded")}</p>` : ""}`;
    return `<section class="schedule-service"><div class="section-title"><h2>${esc(s.service.startTime)} — ${esc(humaniseQuoteLabel(s.order.eventType || "Hospitality"))}</h2><span class="small">${esc(s.service.guestCount)} guests · ${esc(s.service.roomOrArea || s.service.deliveryPoint || s.service.floorLevel || "Location to confirm")}</span></div>${quoteOrderTableHtml(s.order.lines, s.charges)}${details}<p class="service-subtotal">Service subtotal (net): <strong>${gbp(s.totals.net.amount)}</strong></p></section>`;
  }).join("");
  return renderHospitalityQuoteDocument(summary, { createdAt: q.createdAt }, {
    bodyHtml: `${headerDetails}${sections}`,
    hideLocationAndGuests: true,
    vatLabel: "VAT (as recorded)",
    footerReference: `Quote reference · ${q.bookingGroupId}`,
    extraCss: "@page{size:A4;margin:12mm 0 16mm}@page:first{margin-top:0}html,body{background:#fff}.page{min-height:0}.schedule-service{margin-top:24px;break-inside:avoid}.section-title{break-inside:avoid;break-after:avoid}.order thead{display:table-header-group}.order tr{break-inside:avoid}.service-subtotal{text-align:right;break-before:avoid}.totals,.callout{break-inside:avoid}.footer{position:static;margin-top:32px;gap:16px;flex-wrap:wrap;overflow-wrap:anywhere}.footer-reference{max-width:100%;font-size:7pt;color:#aaa1b4;letter-spacing:.02em}",
  });
}
