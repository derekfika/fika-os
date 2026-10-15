import type { CanonicalBooking } from "@/lib/canonical-types";
import { QUOTE_STYLESHEET_CSS, quoteMastheadCss, quoteMastheadHtml, resolveQuoteBranding } from "../../shared/hospitality-quote-document";

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export function runSheetTitle(booking: CanonicalBooking) {
  const date = booking.service.eventDate || "undated";
  const client = booking.client.companyName || "client";
  const site = booking.service.portalSiteLabel?.trim() || "Hospitality";
  return `${site}_Run_Sheet_${date}_${client}`.replace(/[^A-Za-z0-9_-]+/g, "_");
}

export function deliveryContext(booking: CanonicalBooking) {
  const service = booking.service;
  const lines = [
    service.portalSiteLabel && { label: "FIKA service site", value: service.portalSiteLabel },
    service.floorLevel && { label: "Floor / level", value: service.floorLevel },
    service.roomOrArea && { label: "Room / area", value: service.roomOrArea },
    service.deliveryPoint && { label: "Delivery point", value: service.deliveryPoint },
  ].filter((line): line is { label: string; value: string } => Boolean(line));
  return lines.length ? lines : [{ label: "Delivery location", value: "Not supplied" }];
}

export function runSheetHtml(booking: CanonicalBooking) {
  return brandedRunSheetHtml(booking);
  const dietaryEntries = Object.entries(booking.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false);
  const locations = deliveryContext(booking);
  const items = booking.order.items.map(item => `<tr><td><strong>${escapeHtml(item.quantity)} × ${escapeHtml(item.itemName || item.itemId)}</strong>${item.servingInfo ? `<small>${escapeHtml(item.servingInfo)}</small>` : ""}</td><td>£${Number(item.lineTotal).toFixed(2)}</td></tr>`).join("");
  const dietary = dietaryEntries.length
    ? dietaryEntries.map(([key, value]) => `<li>${escapeHtml(pretty(key))}: ${escapeHtml(value)}</li>`).join("")
    : "<li>None recorded</li>";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(runSheetTitle(booking))}</title><style>
    @page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;color:#180d43;font-family:Arial,sans-serif;font-size:11pt}.header{padding:18px 22px;color:#fff;background:#1c0d58}.brand{font-weight:900;font-size:23pt;letter-spacing:-1.5px}.brand span{color:#4ce9cb;font-size:10pt;letter-spacing:1px}.eyebrow{margin:0 0 5px;text-transform:uppercase;letter-spacing:1.3px;font-size:8pt;font-weight:800;color:#6e5db2}.header .eyebrow{color:#81ffe6}.header h1{margin:0;font-size:25pt}.header p{margin:8px 0 0;color:#eee9ff}.grid,.location-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0}.fact,.location{padding:11px 12px;border:1px solid #ddd7f0;border-radius:7px}.fact strong,.location strong{display:block;margin-top:4px;font-size:12pt}.section{margin-top:20px}.section h2{margin:0 0 9px;font-size:15pt}.section h2:after{content:"";display:block;width:40px;border-bottom:3px solid #4ce9cb;margin-top:6px}table{border-collapse:collapse;width:100%}th,td{padding:10px 6px;border-bottom:1px solid #ddd7f0;text-align:left}th{font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#6e5db2}td:last-child,th:last-child{text-align:right}td small{display:block;margin-top:3px;color:#625c79}.total{display:flex;justify-content:flex-end;gap:18px;padding:12px 6px;font-size:12pt}.dietaries{display:flex;gap:6px;flex-wrap:wrap;padding:0;list-style:none}.dietaries li{padding:7px 9px;border-radius:6px;background:#fff1ce;color:#704800}.notes{padding:12px;border-left:4px solid #4ce9cb;background:#f4f2fa;white-space:pre-wrap}.footer{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #ddd7f0;padding:6px 15mm;color:#625c79;font-size:8pt}@media print{.footer{position:fixed}}</style></head><body>
    <header class="header"><div class="brand">FIKA <span>OS</span></div><p class="eyebrow">MNK hospitality · operational run sheet</p><h1>${escapeHtml(booking.client.companyName)}</h1><p>${escapeHtml(booking.service.eventDate)} · ${escapeHtml(booking.service.startTime)} · ${escapeHtml(booking.lifecycleStatus)}</p></header>
    <main><div class="grid"><div class="fact"><p class="eyebrow">Booking for</p><strong>${escapeHtml(booking.client.companyName)}</strong>Customer hospitality request</div><div class="fact"><p class="eyebrow">Host / requester</p><strong>${escapeHtml(booking.client.name)}</strong>${escapeHtml(booking.client.email)}${booking.client.phone ? `<br>${escapeHtml(booking.client.phone)}` : ""}</div><div class="fact"><p class="eyebrow">Service</p><strong>${escapeHtml(booking.order.eventType || "Hospitality")}</strong>${escapeHtml(booking.service.eventDate)} · ${escapeHtml(booking.service.startTime)} · ${escapeHtml(booking.service.guestCount)} pax</div><div class="fact"><p class="eyebrow">Booking reference</p><strong>${escapeHtml(booking.source.sourceBookingId)}</strong>${escapeHtml(booking.canonicalId)}</div></div>
    <section class="section"><h2>Delivery and service location</h2><div class="location-grid">${locations.map(line => `<div class="location"><p class="eyebrow">${escapeHtml(line.label)}</p><strong>${escapeHtml(line.value)}</strong></div>`).join("")}</div></section>
    <section class="section"><h2>Service order</h2><table><thead><tr><th>Item</th><th>Line value</th></tr></thead><tbody>${items}</tbody></table><div class="total"><span>Net £${Number(booking.order.netTotal).toFixed(2)} · VAT £${Number(booking.order.vatTotal).toFixed(2)}</span><strong>Total £${Number(booking.order.grossTotal).toFixed(2)}</strong></div></section>
    <section class="section"><h2>Dietary requirements</h2><ul class="dietaries">${dietary}</ul></section>${booking.notes ? `<section class="section"><h2>Operational notes</h2><div class="notes">${escapeHtml(booking.notes)}</div></section>` : ""}</main><footer class="footer">Generated from canonical Booking ${escapeHtml(booking.canonicalId)} · ${escapeHtml(new Date().toLocaleString("en-GB"))}</footer></body></html>`;
}

export function dailyRunSheetTitle(bookings: CanonicalBooking[]) {
  const date = bookings[0]?.service.eventDate || "undated";
  const labels = [...new Set(bookings.map((booking) => booking.service.portalSiteLabel?.trim()).filter(Boolean))];
  const site = labels.length === 1 ? labels[0] : "Hospitality";
  return `${site}_Daily_Run_Sheet_${date}`;
}

export function dailyRunSheetHtml(bookings: CanonicalBooking[]) {
  return brandedDailyRunSheetHtml(bookings);
  const ordered = [...bookings].sort((left, right) => left.service.startTime.localeCompare(right.service.startTime));
  const date = ordered[0]?.service.eventDate || "Undated";
  const cards = ordered.map(booking => {
    const locations = deliveryContext(booking).map(line => `<span><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value)}</span>`).join("");
    const items = booking.order.items.map(item => `${escapeHtml(item.quantity)} × ${escapeHtml(item.itemName || item.itemId)}`).join(" · ");
    const dietaries = Object.entries(booking.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false).map(([key, value]) => `${escapeHtml(pretty(key))}: ${escapeHtml(value)}`).join(" · ") || "No dietary requirements recorded";
    return `<article class="booking"><header><time>${escapeHtml(booking.service.startTime)}</time><div><h2>${escapeHtml(booking.client.companyName)}</h2><p>${escapeHtml(booking.client.name)} · ${escapeHtml(booking.service.guestCount)} pax · ${escapeHtml(booking.order.eventType || "Hospitality")}</p></div><strong>${escapeHtml(booking.lifecycleStatus)}</strong></header><div class="locations">${locations}</div><div class="order"><b>Order</b><span>${items}</span></div><div class="dietaries"><b>Dietary / allergens</b><span>${dietaries}</span></div>${booking.notes ? `<div class="notes"><b>Operational note</b><span>${escapeHtml(booking.notes)}</span></div>` : ""}</article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(dailyRunSheetTitle(ordered))}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#180d43;font-family:Arial,sans-serif;font-size:10pt}.header{padding:16px 20px;color:#fff;background:#1c0d58}.brand{font-size:20pt;font-weight:900;letter-spacing:-1px}.brand span{color:#4ce9cb;font-size:9pt;letter-spacing:1px}.eyebrow{margin:0 0 5px;text-transform:uppercase;letter-spacing:1.3px;font-size:8pt;font-weight:800;color:#6e5db2}.header .eyebrow{color:#81ffe6}.header h1{margin:0;font-size:23pt}.header p{margin:6px 0 0;color:#eee9ff}.summary{display:flex;justify-content:space-between;gap:15px;margin:13px 0;color:#625c79}.booking{break-inside:avoid;margin:10px 0;border:1px solid #d9d3ed;border-radius:7px;overflow:hidden}.booking header{display:grid;grid-template-columns:68px 1fr auto;align-items:center;gap:12px;padding:9px 11px;background:#f3f0fb}.booking time{font-size:15pt;font-weight:900;color:#1c0d58}.booking h2{margin:0;font-size:13pt}.booking p{margin:3px 0 0;color:#625c79}.booking header>strong{padding:5px 8px;border-radius:999px;background:#e2fbf2;color:#11604c;font-size:8pt}.locations,.order,.dietaries,.notes{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:8px 11px;border-top:1px solid #e2ddef}.locations{display:flex;gap:15px;flex-wrap:wrap}.locations span{padding-right:15px;border-right:1px solid #ddd7ed}.order b,.dietaries b,.notes b{color:#6e5db2;text-transform:uppercase;letter-spacing:.8px;font-size:8pt}.notes{background:#fff9e9}.footer{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #ddd7f0;padding:5px 12mm;color:#625c79;font-size:8pt}</style></head><body><header class="header"><div class="brand">FIKA <span>OS</span></div><p class="eyebrow">MNK hospitality · daily operational run sheet</p><h1>${escapeHtml(date)}</h1><p>${ordered.length} canonical booking${ordered.length === 1 ? "" : "s"} · ordered by service time</p></header><main><div class="summary"><span>Scan each booking for destination, order, dietary information and operational notes.</span><span>Generated ${escapeHtml(new Date().toLocaleString("en-GB"))}</span></div>${cards || "<p>No bookings selected.</p>"}</main><footer class="footer">Canonical Booking data only · No Calendar or legacy workflow was changed.</footer></body></html>`;
}

function pretty(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase()); }

/** Operational run-sheet rules layered on the shared quote stylesheet: the FIKA header, type and colour come from the canonical quote document. */
const RUN_SHEET_CSS = ".locations{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.location{padding:12px 13px;border:1px solid #ded8ed;border-radius:12px;background:#faf9fd}.location strong{display:block;margin-top:4px}.total{display:flex;justify-content:flex-end;gap:18px;padding-top:12px;color:#665d73}.total strong{color:#24163b;font-size:12pt}.notes{margin-top:18px;padding:13px 15px;border-radius:10px;background:#faf9fd;white-space:pre-wrap}.section-title small{color:#665d73}";
const DAILY_RUN_SHEET_CSS = "@page{size:A4 landscape;margin:0}body{font-size:9.5pt}.page{width:297mm;min-height:210mm;padding:0 12mm 13mm}.doc-title{margin:0 0 12px}.doc-title h1{margin:5px 0 6px;font-family:Vim,Gilroy;font-size:22pt;line-height:.95;letter-spacing:-1.2px}.summary{display:flex;justify-content:space-between;gap:12px;margin:0 0 10px;color:#665d73;font-size:8.5pt}.day-section{break-inside:avoid;margin:18px 0}.day-heading{display:flex;align-items:end;gap:12px;border-bottom:3px solid #4df7c2;padding:0 0 7px}.day-heading p{margin:0;color:#4f34c7;font-size:7.5pt;font-weight:900;letter-spacing:1.2px;text-transform:uppercase}.day-heading h2{margin:0;font-size:18pt;letter-spacing:-.04em}.booking{break-inside:avoid;margin:8px 0;border:1px solid #ded8ed;border-radius:11px;overflow:hidden}.booking header{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:11px;padding:8px 10px;background:#faf9fd}.booking time{font-size:15pt;font-weight:900;color:#4f34c7}.booking h2{margin:0;font-size:12.5pt;letter-spacing:-.25px}.booking p{margin:2px 0 0;color:#665d73}.booking header>strong{padding:4px 8px;border-radius:999px;background:#e2fbf2;color:#11604c;font-size:7.5pt}.locations,.row{display:grid;grid-template-columns:100px 1fr;gap:11px;padding:7px 10px;border-top:1px solid #e7e2f0}.locations{display:flex;gap:14px;flex-wrap:wrap}.locations span{padding-right:14px;border-right:1px solid #ded8ed}.row b{color:#4f34c7;font-size:7.5pt;letter-spacing:.9px;text-transform:uppercase}.notes{background:#fff8e8}.footer{position:static;border-top:1px solid #ded8ed;margin:10px 0 0;padding-top:5px;color:#aaa1b4;font-size:7.5pt}";

/** A daily sheet that spans several sites uses the neutral FIKA masthead rather than any one site's artwork. */
export function runSheetBranding(bookings: CanonicalBooking[]) {
  const ids = new Set(bookings.map(booking => booking.service.portalSiteId || ""));
  return resolveQuoteBranding(ids.size === 1 && bookings[0] ? bookings[0].service : {});
}

function brandedRunSheetHtml(booking: CanonicalBooking) {
  const dietaryEntries = Object.entries(booking.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false);
  const locations = deliveryContext(booking);
  const items = booking.order.items.map(item => `<tr><td><div class="item-name">${escapeHtml(item.itemName || item.itemId)}</div>${item.servingInfo ? `<small>${escapeHtml(item.servingInfo)}</small>` : ""}${item.comments ? `<small class="note">${escapeHtml(item.comments)}</small>` : ""}</td><td class="qty">${escapeHtml(item.quantity)}</td><td class="money strong">£${Number(item.lineTotal).toFixed(2)}</td></tr>`).join("");
  const dietary = dietaryEntries.length ? dietaryEntries.map(([key, value]) => `<span>${escapeHtml(pretty(key))}: ${escapeHtml(value)}</span>`).join("") : `<span class="muted">None recorded</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(runSheetTitle(booking))}</title><style>${QUOTE_STYLESHEET_CSS}${RUN_SHEET_CSS}</style></head><body><main class="page">${quoteMastheadHtml(runSheetBranding([booking]))}<section class="intro"><div><div class="eyebrow">Operational run sheet</div><h1>${escapeHtml(booking.client.companyName)}</h1><p><strong>${escapeHtml(booking.client.name)}</strong></p><p class="email">${escapeHtml(booking.client.email)}${booking.client.phone ? ` · ${escapeHtml(booking.client.phone)}` : ""}</p><div class="rule"></div></div><div class="meta"><div class="meta-row"><span class="meta-label">Service</span><span>${escapeHtml(booking.order.eventType || "Hospitality")}</span></div><div class="meta-row"><span class="meta-label">Date &amp; time</span><span>${escapeHtml(booking.service.eventDate)} · ${escapeHtml(booking.service.startTime)}</span></div><div class="meta-row"><span class="meta-label">Guests</span><span>${escapeHtml(booking.service.guestCount)} pax</span></div><div class="meta-row"><span class="meta-label">Status</span><span>${escapeHtml(booking.lifecycleStatus)}</span></div><div class="meta-row"><span class="meta-label">Booking reference</span><span>${escapeHtml(booking.source.sourceBookingId)}</span></div></div></section><section><div class="section-title"><h2>Delivery and service location</h2><span class="small">Where it needs to happen</span></div><div class="locations">${locations.map(line => `<div class="location"><div class="eyebrow">${escapeHtml(line.label)}</div><strong>${escapeHtml(line.value)}</strong></div>`).join("")}</div></section><section><div class="section-title"><h2>Service order</h2><span class="small">What needs to be prepared</span></div><table class="order"><thead><tr><th>Item</th><th>Qty</th><th>Line value</th></tr></thead><tbody>${items}</tbody></table><div class="total"><span>Net £${Number(booking.order.netTotal).toFixed(2)} · VAT £${Number(booking.order.vatTotal).toFixed(2)}</span><strong>Total £${Number(booking.order.grossTotal).toFixed(2)}</strong></div></section><section class="callout"><strong>Dietary requirements</strong><div class="dietaries">${dietary}</div></section>${booking.notes ? `<section class="notes"><div class="eyebrow">Operational notes</div>${escapeHtml(booking.notes)}</section>` : ""}<footer class="footer"><span>FIKA Catering · Hospitality, elevated.</span><span>Canonical Booking ${escapeHtml(booking.canonicalId)}</span></footer></main></body></html>`;
}

function brandedDailyRunSheetHtml(bookings: CanonicalBooking[]) {
  const ordered = [...bookings].sort((left, right) => `${left.service.eventDate}T${left.service.startTime}`.localeCompare(`${right.service.eventDate}T${right.service.startTime}`));
  const date = ordered[0]?.service.eventDate || "Undated";
  const grouped = new Map<string, CanonicalBooking[]>();
  ordered.forEach(booking => grouped.set(booking.service.eventDate, [...(grouped.get(booking.service.eventDate) || []), booking]));
  const daySections = [...grouped.entries()].map(([day, dayBookings]) => {
    const heading = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const dayCards = dayBookings.map(booking => {
      const locations = deliveryContext(booking).map(line => `<span><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value)}</span>`).join("");
      const items = booking.order.items.map(item => `${escapeHtml(item.quantity)} × ${escapeHtml(item.itemName || item.itemId)}`).join(" · ");
      const dietaries = Object.entries(booking.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false).map(([key, value]) => `${escapeHtml(pretty(key))}: ${escapeHtml(value)}`).join(" · ") || "No dietary requirements recorded";
      return `<article class="booking"><header><time>${escapeHtml(booking.service.startTime)}</time><div><h2>${escapeHtml(booking.client.companyName)}</h2><p>${escapeHtml(booking.client.name)} · ${escapeHtml(booking.service.guestCount)} pax · ${escapeHtml(booking.order.eventType || "Hospitality")}</p></div><strong>${escapeHtml(booking.lifecycleStatus)}</strong></header><div class="locations">${locations}</div><div class="row"><b>Order</b><span>${items}</span></div><div class="row"><b>Dietary</b><span>${dietaries}</span></div>${booking.notes ? `<div class="row notes"><b>Notes</b><span>${escapeHtml(booking.notes)}</span></div>` : ""}</article>`;
    }).join("");
    return `<section class="day-section"><header class="day-heading"><p>Service day</p><h2>${escapeHtml(heading)}</h2></header>${dayCards}</section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(dailyRunSheetTitle(ordered))}</title><style>${QUOTE_STYLESHEET_CSS}${quoteMastheadCss(12)}${DAILY_RUN_SHEET_CSS}</style></head><body><main class="page">${quoteMastheadHtml(runSheetBranding(ordered))}<div class="doc-title"><div class="eyebrow">Daily operational run sheet</div><h1>${escapeHtml(date)}</h1></div><div class="summary"><span>Scan each day for destination, order, dietary information and operational notes.</span><span>${ordered.length} booking${ordered.length === 1 ? "" : "s"} · ordered by service time</span></div>${daySections || "<p>No bookings selected.</p>"}<footer class="footer">FIKA Catering · Hospitality, elevated. · Canonical Booking data only</footer></main></body></html>`;
}
