/**
 * Shared FIKA OS quote capability.
 *
 * This is intentionally independent of any dashboard. A dashboard supplies its
 * own settings and a domain supplies a commercial intent; the engine returns an
 * immutable, self-contained commercial snapshot suitable for a quote revision.
 */
export const QUOTE_ENGINE_CONTRACT_VERSION = "fika.quote-engine.v1";

export type Money = { currency: "GBP"; amount: number };
export type QuoteCharge = { code: "delivery" | "management_fee" | "housekeeping" | "security" | "aircon" | "venue_hire"; label: string; net: Money; vatRate: number };
export type QuoteLine = { itemId: string; name: string; description?: string; quantity: number; unitNet: Money; lineNet: Money; servingInfo?: string; choices?: unknown[]; comments?: string };
export type DashboardQuoteSettings = {
  dashboardId: string;
  version: number;
  managementFee: { mode: "fixed" | "percentage"; value: number; label: string };
  deliveryCharge: { enabled: boolean; amount: number; label: string };
  buildingCharges?: { enabled: boolean; housekeeping: { hourly: number; label: string }; security: { hourly: number; minimumHours: number; label: string }; aircon: { hourly: number; afterHour: number; label: string }; venueHire: { enabled: boolean; amount: number; label: string } };
  vatRate: number;
  updatedAt?: string;
  updatedBy?: string;
  /** Safe configuration references; OAuth credentials never live here. */
  googleDriveFolderId?: string;
  googleMenuTemplateId?: string;
  googleMenuFolderId?: string;
  googleQuoteFolderId?: string;
  googleMatrixFolderId?: string;
};
export type QuoteBookingInput = {
  canonicalId: string;
  client: { name: string; companyName: string; email: string; phone?: string };
  service: { eventDate: string; startTime: string; endTime?: string; portalSiteLabel?: string; floorLevel?: string; roomOrArea?: string; deliveryPoint?: string; guestCount: number };
  order: { eventType?: string; items: Array<{ itemId: string; itemName?: string; description?: string; quantity: number; unitPrice: number; lineTotal?: number; servingInfo?: string; choices?: unknown[]; comments?: string }> };
  dietaries: Record<string, unknown>;
  notes?: string;
  deliveryChargeRequired?: boolean;
};
export type QuoteCommercialSnapshot = {
  contractVersion: typeof QUOTE_ENGINE_CONTRACT_VERSION;
  bookingId: string;
  client: QuoteBookingInput["client"];
  service: QuoteBookingInput["service"];
  order: { eventType?: string; lines: QuoteLine[] };
  charges: QuoteCharge[];
  totals: { itemsNet: Money; chargesNet: Money; net: Money; vat: Money; gross: Money; vatRate: number };
  dietaries: Record<string, unknown>;
  notes?: string;
  pricingPolicy: Pick<DashboardQuoteSettings, "dashboardId" | "version" | "managementFee" | "deliveryCharge" | "vatRate">;
};

export const defaultDashboardQuoteSettings = (dashboardId: string): DashboardQuoteSettings => ({
  dashboardId,
  version: 1,
  // Deliberately zero until an authorised dashboard owner configures a fee.
  managementFee: dashboardId === "angel-court-hospitality" ? { mode: "percentage", value: 8, label: "Angel Court management fee" } : { mode: "fixed", value: 0, label: "Management fee" },
  deliveryCharge: { enabled: true, amount: 35, label: "CPU delivery charge" },
  buildingCharges: dashboardId === "angel-court-hospitality" ? { enabled: true, housekeeping: { hourly: 23.68, label: "Housekeeping" }, security: { hourly: 29.95, minimumHours: 8, label: "Security" }, aircon: { hourly: 200, afterHour: 19, label: "Aircon after 7pm" }, venueHire: { enabled: false, amount: 1000, label: "Venue hire" } } : undefined,
  vatRate: 0.2,
});

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const money = (amount: number): Money => ({ currency: "GBP", amount: round(amount) });

export function humaniseQuoteLabel(value: string) {
  return value
    .trim()
    .replace(/[_.-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => /^[A-Z0-9&]+$/.test(word)
      ? word
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

export function formatQuoteDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatQuoteDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(date);
}

export function formatQuoteFilenameDate(value: string) {
  return formatQuoteDate(value).replaceAll(" ", "_");
}

export function calculateQuoteSnapshot(input: QuoteBookingInput, settings: DashboardQuoteSettings): QuoteCommercialSnapshot {
  if (!Number.isFinite(settings.vatRate) || settings.vatRate < 0 || settings.vatRate > 1) throw new Error("Dashboard quote VAT rate must be between 0 and 1.");
  if (!Number.isFinite(settings.managementFee.value) || settings.managementFee.value < 0) throw new Error("Dashboard management fee must be zero or greater.");
  if (!Number.isFinite(settings.deliveryCharge.amount) || settings.deliveryCharge.amount < 0) throw new Error("Dashboard delivery charge must be zero or greater.");
  const lines = input.order.items.map(item => {
    const quantity = Number(item.quantity); const unit = Number(item.unitPrice);
    if (!item.itemId || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unit) || unit < 0) throw new Error("A quote line has invalid quantity or price.");
    return { itemId: item.itemId, name: item.itemName || item.itemId, ...(item.description ? { description: item.description } : {}), quantity, unitNet: money(unit), lineNet: money(quantity * unit), ...(item.servingInfo ? { servingInfo: item.servingInfo } : {}), ...(item.choices ? { choices: structuredClone(item.choices) } : {}), ...(item.comments ? { comments: item.comments } : {}) };
  });
  const itemsNet = round(lines.reduce((total, line) => total + line.lineNet.amount, 0));
  const charges: QuoteCharge[] = [];
  if (input.deliveryChargeRequired) charges.push({ code: "delivery", label: settings.deliveryCharge.label, net: money(settings.deliveryCharge.amount), vatRate: settings.vatRate });
  const building = settings.buildingCharges;
  if (building?.enabled && input.service.guestCount >= 100) {
    if (!input.service.endTime) throw new Error("An end time is required for Angel Court bookings of 100 guests or more.");
    const minutes = (value: string) => { const [hours, mins] = value.split(":").map(Number); return hours * 60 + mins; };
    const start = minutes(input.service.startTime); const end = minutes(input.service.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("The service end time must be later than the start time.");
    const durationHours = (end - start) / 60;
    charges.push({ code: "housekeeping", label: building.housekeeping.label, net: money(durationHours * building.housekeeping.hourly), vatRate: settings.vatRate });
    charges.push({ code: "security", label: building.security.label, net: money(Math.max(durationHours, building.security.minimumHours) * building.security.hourly), vatRate: settings.vatRate });
    const afterSevenStart = Math.max(start, building.aircon.afterHour * 60);
    if (end > afterSevenStart) charges.push({ code: "aircon", label: building.aircon.label, net: money(((end - afterSevenStart) / 60) * building.aircon.hourly), vatRate: settings.vatRate });
    // Venue hire is intentionally disabled until the annual occupier allowance
    // has a governed source of truth.
    if (building.venueHire.enabled) throw new Error("Venue hire requires an annual occupier allowance before it can be quoted automatically.");
  }
  const managementBase = itemsNet + charges.reduce((total, charge) => total + charge.net.amount, 0);
  const managementAmount = settings.managementFee.mode === "percentage" ? managementBase * (settings.managementFee.value / 100) : settings.managementFee.value;
  if (managementAmount > 0) charges.push({ code: "management_fee", label: settings.managementFee.label, net: money(managementAmount), vatRate: settings.vatRate });
  const chargesNet = round(charges.reduce((total, charge) => total + charge.net.amount, 0));
  const net = round(itemsNet + chargesNet); const vat = round(net * settings.vatRate);
  return { contractVersion: QUOTE_ENGINE_CONTRACT_VERSION, bookingId: input.canonicalId, client: structuredClone(input.client), service: structuredClone(input.service), order: { ...(input.order.eventType ? { eventType: input.order.eventType } : {}), lines }, charges, totals: { itemsNet: money(itemsNet), chargesNet: money(chargesNet), net: money(net), vat: money(vat), gross: money(net + vat), vatRate: settings.vatRate }, dietaries: structuredClone(input.dietaries), ...(input.notes ? { notes: input.notes } : {}), pricingPolicy: { dashboardId: settings.dashboardId, version: settings.version, managementFee: structuredClone(settings.managementFee), deliveryCharge: structuredClone(settings.deliveryCharge), vatRate: settings.vatRate } };
}

export function quoteDocumentHtml(snapshot: QuoteCommercialSnapshot, reference: { id: string; revision: number; createdAt: string }, logoUrl?: string) {
  return compactBrandedQuoteDocumentHtml(snapshot, reference, logoUrl);
  const esc = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const gbp = (value: number) => `£${value.toFixed(2)}`;
  const serviceLocation = snapshot.service.roomOrArea || snapshot.service.floorLevel || snapshot.service.deliveryPoint || "Location to confirm";
  const rows = snapshot.order.lines.map(line => `<tr><td><strong>${esc(line.quantity)} × ${esc(line.name)}</strong>${line.servingInfo ? `<small>${esc(line.servingInfo)}</small>` : ""}${line.description ? `<small>${esc(line.description)}</small>` : ""}</td><td>${gbp(line.lineNet.amount)}</td></tr>`).join("");
  const chargeRows = snapshot.charges.map(charge => `<tr class="charge"><td>${esc(charge.label)}</td><td>${gbp(charge.net.amount)}</td></tr>`).join("");
  const dietaries = Object.entries(snapshot.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false).map(([key, value]) => `${esc(key)}: ${esc(value)}`).join(" · ") || "None recorded";
  const logo = logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="FIKA" />` : `<strong class="wordmark">FIKA</strong>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Quote ${esc(reference.id)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#24163b;font-family:Arial,sans-serif;font-size:10pt}.page{min-height:297mm;padding:0 18mm 16mm}.masthead{height:52mm;margin:0 -18mm 20mm;padding:14mm 18mm;background:#4f34c7;display:flex;align-items:center}.logo{display:block;max-width:120px;max-height:31px;object-fit:contain}.wordmark{color:#fff;font-size:30pt;letter-spacing:-2px}.top{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}.kicker,.meta dt,th{font-size:7.5pt;letter-spacing:1.25px;text-transform:uppercase;font-weight:800;color:#4f34c7}.top h1{font-size:25pt;letter-spacing:-1.2px;margin:4px 0 8px}.top p{margin:3px 0;line-height:1.4}.meta{border-left:3px solid #4df7c2;padding-left:14px}.meta div{margin:0 0 9px}.meta dt{margin-bottom:2px}.meta dd{margin:0;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:30px}th{padding:9px 0;border-bottom:2px solid #4f34c7;text-align:left}th:last-child,td:last-child{text-align:right}td{vertical-align:top;padding:12px 0;border-bottom:1px solid #dedbea}td small{display:block;color:#665d73;line-height:1.4;margin-top:3px}.charge td{color:#43346e}.totals{width:290px;margin:18px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:5px 0}.totals .gross{border-top:3px solid #4f34c7;margin-top:4px;padding-top:9px;font-size:13pt;font-weight:900}.notes{margin-top:27px;border-left:4px solid #4df7c2;background:#f4f1fb;padding:12px 14px;line-height:1.45}.footer{position:fixed;bottom:13mm;left:18mm;right:18mm;display:flex;justify-content:space-between;color:#665d73;font-size:8pt;border-top:1px solid #dedbea;padding-top:8px}</style></head><body><main class="page"><header class="masthead">${logo}</header><section class="top"><div><div class="kicker">Hospitality quotation · Revision ${esc(reference.revision)}</div><h1>${esc(snapshot.client.companyName)}</h1><p><strong>${esc(snapshot.client.name)}</strong><br>${esc(snapshot.client.email)}${snapshot.client.phone ? `<br>${esc(snapshot.client.phone)}` : ""}</p></div><dl class="meta"><div><dt>Service</dt><dd>${esc(snapshot.order.eventType || "Hospitality service")}</dd></div><div><dt>Date and time</dt><dd>${esc(snapshot.service.eventDate)} · ${esc(snapshot.service.startTime)}${snapshot.service.endTime ? `–${esc(snapshot.service.endTime)}` : ""}</dd></div><div><dt>Delivery location</dt><dd>${esc(snapshot.service.portalSiteLabel || "MNK")} · ${esc(serviceLocation)}</dd></div><div><dt>Guests</dt><dd>${esc(snapshot.service.guestCount)} guests</dd></div><div><dt>Quote reference</dt><dd>${esc(reference.id)}</dd></div></dl></section><table><thead><tr><th>Service order</th><th>Net value</th></tr></thead><tbody>${rows}${chargeRows}</tbody></table><section class="totals"><div><span>Items</span><b>${gbp(snapshot.totals.itemsNet.amount)}</b></div><div><span>Charges</span><b>${gbp(snapshot.totals.chargesNet.amount)}</b></div><div><span>Total net</span><b>${gbp(snapshot.totals.net.amount)}</b></div><div><span>VAT (${Math.round(snapshot.totals.vatRate * 100)}%)</span><b>${gbp(snapshot.totals.vat.amount)}</b></div><div class="gross"><span>Total gross to pay</span><b>${gbp(snapshot.totals.gross.amount)}</b></div></section><section class="notes"><strong>Dietary requirements</strong><br>${dietaries}${snapshot.notes ? `<br><br><strong>Notes</strong><br>${esc(snapshot.notes)}` : ""}</section><footer class="footer"><span>FIKA Catering · Hospitality, elevated.</span><span>Generated ${esc(reference.createdAt)}</span></footer></main></body></html>`;
}

/** Brand-forward renderer used by the Hospitality dashboard and future domains. */
export function brandedQuoteDocumentHtml(snapshot: QuoteCommercialSnapshot, reference: { id: string; revision: number; createdAt: string }, logoUrl?: string) {
  const esc = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const gbp = (value: number) => `\u00a3${value.toFixed(2)}`;
  const serviceLocation = snapshot.service.roomOrArea || snapshot.service.floorLevel || snapshot.service.deliveryPoint || "Location to confirm";
  const logo = logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="FIKA" />` : `<span class="wordmark">FIKA<span>OS</span></span>`;
  const lineRows = snapshot.order.lines.map(line => {
    const choices = Array.isArray(line.choices) && line.choices.length ? `<small>${esc(line.choices.map(choice => typeof choice === "object" && choice ? Object.values(choice as Record<string, unknown>).join(": ") : String(choice)).join(" · "))}</small>` : "";
    return `<tr><td><div class="item-name">${esc(line.name)}</div>${line.description ? `<small>${esc(line.description)}</small>` : ""}${line.servingInfo ? `<small class="muted">${esc(line.servingInfo)}</small>` : ""}${choices}${line.comments ? `<small class="note">${esc(line.comments)}</small>` : ""}</td><td class="qty">${esc(line.quantity)}</td><td class="money">${gbp(line.unitNet.amount)}</td><td class="money strong">${gbp(line.lineNet.amount)}</td></tr>`;
  }).join("");
  const chargeRows = snapshot.charges.map(charge => `<tr class="charge"><td colspan="3">${esc(charge.label)}</td><td class="money strong">${gbp(charge.net.amount)}</td></tr>`).join("");
  const dietaries = Object.entries(snapshot.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false).map(([key, value]) => `<span>${esc(key)}: ${esc(value)}</span>`).join("") || `<span class="muted">None recorded</span>`;
  const serviceLabel = humaniseQuoteLabel(snapshot.order.eventType || "Hospitality");
  const serviceDate = formatQuoteDate(snapshot.service.eventDate);
  const generatedAt = formatQuoteDateTime(reference.createdAt);
  const revisionLabel = reference.revision > 1 ? `Revision ${reference.revision}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA quote ${esc(reference.id)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html{background:#eeeaf5}body{margin:0;background:#eeeaf5;color:#24163b;font-family:Gilroy,Arial,sans-serif;font-size:10.5pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}@font-face{font-family:Gilroy;src:url('/fonts/GILROY-REGULAR.TTF') format('truetype');font-weight:400}@font-face{font-family:Gilroy;src:url('/fonts/GILROY-BLACK.TTF') format('truetype');font-weight:900}.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:0 16mm 19mm;position:relative}.masthead{height:47mm;margin:0 -16mm 17mm;padding:13mm 16mm;background:linear-gradient(118deg,#24115c 0%,#4f34c7 72%);display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden}.masthead:after{content:"";position:absolute;width:230px;height:460px;right:8%;top:-180px;border-left:6px solid #4df7c2;transform:rotate(16deg);opacity:.9}.logo{position:relative;z-index:1;display:block;max-width:126px;max-height:36px;object-fit:contain}.wordmark{position:relative;z-index:1;color:#fff;font-size:34pt;font-weight:900;letter-spacing:-2.8px}.wordmark span{margin-left:5px;color:#4df7c2;font-size:12pt;letter-spacing:.08em}.masthead-label{position:relative;z-index:1;color:#fff;text-align:right;font-size:8pt;font-weight:900;letter-spacing:1.4px;text-transform:uppercase}.masthead-label strong{display:block;margin-top:5px;color:#4df7c2;font-size:16pt;letter-spacing:-.04em;text-transform:none}.eyebrow,.meta-label,th{font-size:7.5pt;font-weight:900;letter-spacing:1.35px;text-transform:uppercase;color:#4f34c7}.intro{display:grid;grid-template-columns:1.12fr .88fr;gap:18px;align-items:start}.intro h1{margin:5px 0 7px;font-size:26pt;line-height:.95;letter-spacing:-1.4px}.intro p{margin:3px 0;color:#665d73}.intro .email{font-size:9pt}.meta{display:grid;gap:9px;padding:15px 16px;border:1px solid #ded8ed;border-radius:14px;background:#faf9fd}.meta-row{display:flex;justify-content:space-between;gap:14px}.meta-row span:last-child{text-align:right;font-weight:900}.rule{height:4px;width:42px;margin:16px 0 0;background:#4df7c2}.section-title{display:flex;justify-content:space-between;align-items:end;margin:26px 0 8px}.section-title h2{margin:0;font-size:15pt;letter-spacing:-.5px}.section-title .small{color:#665d73;font-size:8.5pt}.order{width:100%;border-collapse:collapse}.order th{padding:10px 8px;border-bottom:2px solid #4f34c7;text-align:left}.order th:first-child{padding-left:0}.order td{padding:11px 8px;border-bottom:1px solid #e7e2f0;vertical-align:top}.order td:first-child{padding-left:0}.order th:nth-child(2),.order td:nth-child(2){text-align:center;width:42px}.order th:nth-child(3),.order td:nth-child(3){text-align:right;width:82px}.order th:last-child,.order td:last-child{text-align:right;width:92px;padding-right:0}.item-name{font-weight:900}.order small{display:block;margin-top:3px;color:#665d73;font-size:8.5pt;line-height:1.3}.order small.note{color:#4f34c7}.money{white-space:nowrap}.strong{font-weight:900}.charge td{color:#4f34c7;background:#faf9fd}.totals{width:285px;margin:17px 0 0 auto}.totals-row{display:flex;justify-content:space-between;gap:16px;padding:4px 0;color:#665d73}.totals-row strong{color:#24163b}.totals-row.gross{margin-top:6px;padding-top:9px;border-top:3px solid #4f34c7;font-size:13pt;color:#24163b}.callout{margin-top:24px;padding:15px 17px;border-left:4px solid #4df7c2;border-radius:0 11px 11px 0;background:#f4f1fb}.callout strong{display:block;margin-bottom:7px;color:#4f34c7}.dietaries{display:flex;flex-wrap:wrap;gap:6px}.dietaries span{padding:5px 8px;border-radius:999px;background:#fff0ce;color:#704800;font-size:8.5pt;font-weight:700}.muted{color:#665d73}.footer{position:fixed;bottom:10mm;left:16mm;right:16mm;display:flex;justify-content:space-between;border-top:1px solid #ded8ed;padding-top:7px;color:#8a819d;font-size:8pt}</style></head><body><main class="page"><header class="masthead">${logo}<div class="masthead-label">Hospitality quotation<strong>Revision ${esc(reference.revision)}</strong></div></header><section class="intro"><div><div class="eyebrow">Prepared for</div><h1>${esc(snapshot.client.companyName)}</h1><p><strong>${esc(snapshot.client.name)}</strong></p><p class="email">${esc(snapshot.client.email)}${snapshot.client.phone ? ` · ${esc(snapshot.client.phone)}` : ""}</p><div class="rule"></div></div><div class="meta"><div class="meta-row"><span class="meta-label">Service</span><span>${esc(snapshot.order.eventType || "Hospitality")}</span></div><div class="meta-row"><span class="meta-label">Date & time</span><span>${esc(snapshot.service.eventDate)} · ${esc(snapshot.service.startTime)}${snapshot.service.endTime ? `–${esc(snapshot.service.endTime)}` : ""}</span></div><div class="meta-row"><span class="meta-label">Location</span><span>${esc(snapshot.service.portalSiteLabel || "MNK")} · ${esc(serviceLocation)}</span></div><div class="meta-row"><span class="meta-label">Guests</span><span>${esc(snapshot.service.guestCount)}</span></div><div class="meta-row"><span class="meta-label">Quote reference</span><span>${esc(reference.id)}</span></div></div></section><div class="section-title"><h2>Your hospitality service</h2><span class="small">Prices shown net of VAT</span></div><table class="order"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Net</th></tr></thead><tbody>${lineRows}${chargeRows}</tbody></table><section class="totals"><div class="totals-row"><span>Items</span><strong>${gbp(snapshot.totals.itemsNet.amount)}</strong></div><div class="totals-row"><span>Additional charges</span><strong>${gbp(snapshot.totals.chargesNet.amount)}</strong></div><div class="totals-row"><span>Total net</span><strong>${gbp(snapshot.totals.net.amount)}</strong></div><div class="totals-row"><span>VAT (${Math.round(snapshot.totals.vatRate * 100)}%)</span><strong>${gbp(snapshot.totals.vat.amount)}</strong></div><div class="totals-row gross"><span>Total to pay</span><strong>${gbp(snapshot.totals.gross.amount)}</strong></div></section><section class="callout"><strong>Dietary requirements</strong><div class="dietaries">${dietaries}</div>${snapshot.notes ? `<div style="margin-top:12px"><strong>Notes</strong>${esc(snapshot.notes)}</div>` : ""}</section><footer class="footer"><span>FIKA Catering · Hospitality, elevated.</span><span>Generated ${esc(reference.createdAt)}</span></footer></main></body></html>`;
}

export function compactBrandedQuoteDocumentHtml(snapshot: QuoteCommercialSnapshot, reference: { id: string; revision: number; createdAt: string }, logoUrl?: string) {
  const escapedReference = String(reference.id).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const serviceLabel = escapeHtml(humaniseQuoteLabel(snapshot.order.eventType || "Hospitality"));
  const serviceDate = escapeHtml(formatQuoteDate(snapshot.service.eventDate));
  const generatedAt = escapeHtml(formatQuoteDateTime(reference.createdAt));
  const revisionLabel = reference.revision > 1 ? `Revision ${reference.revision}` : "";
  return brandedQuoteDocumentHtml(snapshot, reference, logoUrl)
    .replaceAll(`Revision ${reference.revision}`, revisionLabel)
    .replaceAll(escapeHtml(snapshot.order.eventType || "Hospitality"), serviceLabel)
    .replaceAll(escapeHtml(snapshot.service.eventDate), serviceDate)
    .replaceAll(escapeHtml(reference.createdAt), generatedAt)
    .replace(/<div class="meta-row"><span class="meta-label">Quote reference<\/span><span>.*?<\/span><\/div>/, "")
    .replace('<footer class="footer">', `<footer class="footer"><span class="footer-reference">Quote reference · ${escapedReference}</span>`)
    .replace("</head>", "<style>@page{size:A4;margin:0}.page{min-height:0}.footer{position:static;margin-top:28mm}.footer-reference{font-size:7pt;color:#aaa1b4;letter-spacing:.02em}.order thead{display:table-header-group}.order tr{break-inside:avoid;page-break-inside:avoid}.totals,.callout{break-inside:avoid;page-break-inside:avoid}</style></head>");
}
