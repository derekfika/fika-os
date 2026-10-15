import { quoteDocumentHtml, humaniseQuoteLabel } from "./quote-engine";
import type { HospitalityGroupQuote } from "./hospitality-group-quote-workflow";
import { groupHash } from "./hospitality-group-commercial";

const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const gbp = (n: number) => `£${n.toFixed(2)}`;
/** Extend the existing branded quote renderer with time-ordered service sections and its existing final totals component. */
export function hospitalityGroupQuoteHtml(q: HospitalityGroupQuote) {
  const first = q.snapshots[0];
  const commonNotes = (first.notes || "").split(/\n\n/).filter(note => note && !/^(Event:|Service note:|All Day Hospitality request )/.test(note) && q.snapshots.every(s => (s.notes || "").split(/\n\n/).includes(note)));
  const sharedDietaries = q.snapshots.every(s => groupHash(s.dietaries) === groupHash(first.dietaries));
  const lastTime = q.snapshots.flatMap(s => [s.service.startTime, s.service.endTime || s.service.startTime]).sort().at(-1)!;
  const summary = { ...first, notes: commonNotes.join("\n\n"), dietaries: sharedDietaries ? first.dietaries : { "Service requirements": "See service sections" }, service: { ...first.service, portalSiteLabel: first.service.portalSiteLabel || "Hospitality", startTime: first.service.startTime, endTime: lastTime }, order: { eventType: "All Day Hospitality", lines: [] }, charges: [], totals: { ...first.totals, ...Object.fromEntries(Object.entries(q.totals).map(([key, amount]) => [key, { amount, currency: "GBP" as const }])) } };
  const sections = q.snapshots.map(s => `<section class="schedule-service"><div class="section-title"><h2>${esc(s.service.startTime)} — ${esc(humaniseQuoteLabel(s.order.eventType || "Hospitality"))}</h2><span class="small">${esc(s.service.guestCount)} guests · ${esc(s.service.roomOrArea || s.service.deliveryPoint || s.service.floorLevel || "Location to confirm")}</span></div><table class="order"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Net</th></tr></thead><tbody>${s.order.lines.map(l => `<tr><td><strong>${esc(l.name)}</strong>${l.description ? `<small>${esc(l.description)}</small>` : ""}${l.servingInfo ? `<small>${esc(l.servingInfo)}</small>` : ""}${l.choices?.length ? `<small>${esc(l.choices.map(c => typeof c === "object" && c ? Object.values(c).join(": ") : String(c)).join(" · "))}</small>` : ""}${l.comments ? `<small>${esc(l.comments)}</small>` : ""}</td><td>${esc(l.quantity)}</td><td>${gbp(l.unitNet.amount)}</td><td>${gbp(l.lineNet.amount)}</td></tr>`).join("")}${s.charges.map(c => `<tr class="charge"><td colspan="3">${esc(c.label)}${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</td><td>${gbp(c.net.amount)}</td></tr>`).join("")}</tbody></table><p class="service-subtotal">Service subtotal (net): <strong>${gbp(s.totals.net.amount)}</strong></p></section>`).join("");
  const client = first.client as typeof first.client & { invoiceReference?: string };
  const eventName = first.notes?.match(/^Event: (.+)$/m)?.[1];
  const headerDetails = `<p>Request reference: ${esc(q.bookingGroupId)}</p>${eventName ? `<p>Event: ${esc(eventName)}</p>` : ""}${client.invoiceReference ? `<p>PO / reference: ${esc(client.invoiceReference)}</p>` : ""}`;
  const serviceDetails = q.snapshots.map(s => {
    const notes = (s.notes || "").split(/\n\n/).filter(note => note && !/^(Event:|All Day Hospitality request )/.test(note) && !commonNotes.includes(note));
    return `${notes.length ? `<p>${notes.map(esc).join("<br>")}</p>` : ""}${!sharedDietaries ? `<p>Dietary requirements: ${esc(Object.entries(s.dietaries).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "None recorded")}</p>` : ""}`;
  });
  let serviceIndex = 0;
  const schedule = sections.replace(/<p class="service-subtotal">/g, () => `${serviceDetails[serviceIndex++]}<p class="service-subtotal">`);
  const document = quoteDocumentHtml(summary, { id: q.bookingGroupId, revision: q.revision, createdAt: q.createdAt });
  const serviceArea = /<div class="section-title"><h2>Your hospitality service<\/h2>[\s\S]*?<section class="totals">/;
  if (!serviceArea.test(document)) throw new Error("The quote document template no longer supports grouped service sections.");
  return document
    .replace(serviceArea, `${headerDetails}${schedule}<section class="totals">`)
    .replace(/<div class="meta-row"><span class="meta-label">(?:Location|Guests)<\/span><span>[\s\S]*?<\/span><\/div>/g, "")
    .replace(/VAT \(\d+%\)/, "VAT (as recorded)")
    .replace("</head>", "<style>@page{size:A4;margin:12mm 0 16mm}@page:first{margin-top:0}html,body{background:#fff}.schedule-service{margin-top:24px;break-inside:avoid}.section-title{break-inside:avoid;break-after:avoid}.service-subtotal{text-align:right;break-before:avoid}.totals{break-inside:avoid}.footer{position:static;margin-top:32px;gap:16px;flex-wrap:wrap;overflow-wrap:anywhere}.footer-reference{max-width:100%}</style></head>");
}
