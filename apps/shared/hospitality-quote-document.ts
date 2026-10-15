/**
 * Canonical customer-facing Hospitality quotation renderer and brand configuration.
 *
 * One visual system (FIKA logo left, site/client logo right, diagonal accent, Gilroy/Vim type) is used by the
 * Hospitality dashboard (single-service quotes) and by the Hub-owned grouped quote artifact. Platform-specific
 * content is supplied through `options.bodyHtml`; the shell, typography and totals are never re-implemented.
 * "FIKA OS" is internal product branding and must never appear on a customer-facing quotation.
 */
import { FIKA_LOGO_DATA_URI, SITE_LOGO_DATA_URIS, GILROY_BLACK_DATA_URI, GILROY_REGULAR_DATA_URI, VIM_HEAVY_DATA_URI } from "./hospitality-quote-brand-assets.generated";

type Money = { amount: number; currency?: string };
export type QuoteDocumentLine = { itemId?: string; name: string; description?: string; quantity: number; unitNet?: Money; lineNet: Money; servingInfo?: string; choices?: unknown[]; comments?: string };
export type QuoteDocumentCharge = { label: string; net: Money; detail?: string };
export type QuoteDocumentSnapshot = {
  client: { name: string; companyName: string; email: string; phone?: string };
  service: { eventDate: string; startTime: string; endTime?: string; guestCount: number | string; roomOrArea?: string; floorLevel?: string; deliveryPoint?: string; portalSiteId?: string; portalSiteLabel?: string };
  order: { eventType?: string; lines: QuoteDocumentLine[] };
  charges: QuoteDocumentCharge[];
  totals: { itemsNet: Money; chargesNet: Money; net: Money; vat: Money; gross: Money; vatRate: number };
  dietaries: Record<string, unknown>;
  notes?: string;
};

/**
 * Per-site quote branding. Logos come from the generated asset map (keyed by the same site id); a site with no
 * artwork deliberately falls back to its text label in the masthead rather than inventing a logo.
 */
export const HOSPITALITY_QUOTE_BRAND_CONFIG: Record<string, { label: string; reversedLogo?: boolean }> = {
  mnk: { label: "MNK", reversedLogo: true },
  rcoa: { label: "RCoA" },
  "angel-court": { label: "Angel Court" },
  cfc: { label: "CFC" },
  "munich-re": { label: "Munich Re" },
};

export type ResolvedQuoteBranding = { siteId: string; label: string; logo?: string; reversedLogo: boolean };
export function resolveQuoteBranding(service: { portalSiteId?: string; portalSiteLabel?: string }): ResolvedQuoteBranding {
  const siteId = service.portalSiteId || "";
  const configured = Object.hasOwn(HOSPITALITY_QUOTE_BRAND_CONFIG, siteId) ? HOSPITALITY_QUOTE_BRAND_CONFIG[siteId] : undefined;
  return {
    siteId,
    label: service.portalSiteLabel?.trim() || configured?.label || "Hospitality",
    logo: Object.hasOwn(SITE_LOGO_DATA_URIS, siteId) ? SITE_LOGO_DATA_URIS[siteId] : undefined,
    reversedLogo: Boolean(configured?.reversedLogo),
  };
}

export const quoteEsc = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const quoteGbp = (value: number) => `£${Number(value || 0).toFixed(2)}`;
const humanise = (value: string) => value.trim().replace(/[_.-]+/g, " ").split(/\s+/).filter(Boolean).map(word => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`).join(" ");
const quoteDate = (value: string) => { const [year, month, day] = value.split("-").map(Number); return [year, month, day].every(Number.isFinite) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12))) : value; };
const quoteDateTime = (value: string) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(date) : value; };

const FONT_CSS = `@font-face{font-family:Vim;src:url(${VIM_HEAVY_DATA_URI}) format('opentype');font-weight:900}@font-face{font-family:Gilroy;src:url(${GILROY_REGULAR_DATA_URI}) format('truetype');font-weight:400}@font-face{font-family:Gilroy;src:url(${GILROY_BLACK_DATA_URI}) format('truetype');font-weight:900}`;
const QUOTE_CSS = `@page{size:A4;margin:0}*{box-sizing:border-box}html{background:#eeeaf5}body{margin:0;background:#eeeaf5;color:#24163b;font-family:Gilroy;font-size:10.5pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:0 16mm 19mm;position:relative}.masthead{height:47mm;margin:0 -16mm 17mm;padding:13mm 16mm;background:linear-gradient(118deg,#24115c 0%,#4f34c7 72%);display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden}.masthead:after{content:"";position:absolute;width:230px;height:460px;right:8%;top:-180px;border-left:6px solid #4df7c2;transform:rotate(16deg);opacity:.9}.logo{position:relative;z-index:1;display:block;width:126px;max-height:36px;object-fit:contain}.site-logo{position:relative;z-index:1;max-width:170px;max-height:72px;object-fit:contain;background:#fff;padding:8px;border-radius:8px}.site-logo--reversed{background:transparent;padding:0}.masthead-label{position:relative;z-index:1;color:#fff;font-weight:900}.eyebrow,.meta-label,th{font-size:7.5pt;font-weight:900;letter-spacing:1.35px;text-transform:uppercase;color:#4f34c7}.intro{display:grid;grid-template-columns:1.12fr .88fr;gap:18px;align-items:start}.intro h1,.section-title h2{font-family:Vim,Gilroy}.intro h1{margin:5px 0 7px;font-size:26pt;line-height:.95;letter-spacing:-1.4px}.intro p{margin:3px 0;color:#665d73}.intro .email{font-size:9pt}.rule{height:4px;width:42px;margin:16px 0 0;background:#4df7c2}.meta{display:grid;gap:9px;padding:15px 16px;border:1px solid #ded8ed;border-radius:14px;background:#faf9fd}.meta-row{display:flex;justify-content:space-between;gap:14px}.meta-row span:last-child{text-align:right;font-weight:900}.section-title{display:flex;justify-content:space-between;align-items:end;margin:26px 0 8px}.section-title h2{margin:0;font-size:15pt;letter-spacing:-.5px}.section-title .small{color:#665d73;font-size:8.5pt}.order{width:100%;border-collapse:collapse}.order th{padding:10px 8px;border-bottom:2px solid #4f34c7;text-align:left}.order th:first-child{padding-left:0}.order td{padding:11px 8px;border-bottom:1px solid #e7e2f0;vertical-align:top}.order td:first-child{padding-left:0}.order th:nth-child(2),.order td:nth-child(2){text-align:center;width:42px}.order th:nth-child(3),.order td:nth-child(3){text-align:right;width:82px}.order th:last-child,.order td:last-child{text-align:right;width:92px;padding-right:0}.item-name{font-weight:900}.order small{display:block;margin-top:3px;color:#665d73;font-size:8.5pt;line-height:1.3}.order small.note{color:#4f34c7}.money{white-space:nowrap}.strong{font-weight:900}.charge td{color:#4f34c7;background:#faf9fd}.totals{width:285px;margin:17px 0 0 auto}.totals-row{display:flex;justify-content:space-between;gap:16px;padding:4px 0;color:#665d73}.totals-row strong{color:#24163b}.totals-row.gross{margin-top:6px;padding-top:9px;border-top:3px solid #4f34c7;font-size:13pt;color:#24163b}.callout{margin-top:24px;padding:15px 17px;border-left:4px solid #4df7c2;border-radius:0 11px 11px 0;background:#f4f1fb}.callout strong{display:block;margin-bottom:7px;color:#4f34c7}.dietaries{display:flex;flex-wrap:wrap;gap:6px}.dietaries span{padding:5px 8px;border-radius:999px;background:#fff0ce;color:#704800;font-size:8.5pt;font-weight:700}.muted{color:#665d73}.footer{position:fixed;bottom:10mm;left:16mm;right:16mm;display:flex;justify-content:space-between;border-top:1px solid #ded8ed;padding-top:7px;color:#8a819d;font-size:8pt}`;

/** Canonical masthead: FIKA logo left, site/client logo (or text label when no artwork exists) right. */
export function quoteMastheadHtml(branding: ResolvedQuoteBranding) {
  const right = branding.logo ? `<img class="site-logo${branding.reversedLogo ? " site-logo--reversed" : ""}" src="${branding.logo}" alt="${quoteEsc(branding.label)}" />` : `<div class="masthead-label">${quoteEsc(branding.label)}</div>`;
  return `<header class="masthead"><img class="logo" src="${FIKA_LOGO_DATA_URI}" alt="FIKA" />${right}</header>`;
}

/** Canonical item/charge table, shared by single-service quotes and each grouped service section. */
export function quoteOrderTableHtml(lines: QuoteDocumentLine[], charges: QuoteDocumentCharge[]) {
  const rows = lines.map(line => { const choices = line.choices?.length ? `<small>${quoteEsc(line.choices.map(choice => typeof choice === "object" && choice ? Object.values(choice as Record<string, unknown>).join(": ") : String(choice)).join(" · "))}</small>` : ""; return `<tr><td><div class="item-name">${quoteEsc(line.name)}</div>${line.description ? `<small>${quoteEsc(line.description)}</small>` : ""}${line.servingInfo ? `<small class="muted">${quoteEsc(line.servingInfo)}</small>` : ""}${choices}${line.comments ? `<small class="note">${quoteEsc(line.comments)}</small>` : ""}</td><td class="qty">${quoteEsc(line.quantity)}</td><td class="money">${quoteGbp(line.unitNet?.amount ?? 0)}</td><td class="money strong">${quoteGbp(line.lineNet.amount)}</td></tr>`; }).join("");
  const chargeRows = charges.map(charge => `<tr class="charge"><td colspan="3">${quoteEsc(charge.label)}${charge.detail ? `<small>${quoteEsc(charge.detail)}</small>` : ""}</td><td class="money strong">${quoteGbp(charge.net.amount)}</td></tr>`).join("");
  return `<table class="order"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Net</th></tr></thead><tbody>${rows}${chargeRows}</tbody></table>`;
}

export type HospitalityQuoteDocumentOptions = {
  /** Replaces the default "Your hospitality service" title and single order table (grouped multi-service body). */
  bodyHtml?: string;
  /** Omit the single-location/guest rows when a document spans several services. */
  hideLocationAndGuests?: boolean;
  vatLabel?: string;
  /** Extra CSS appended after the canonical stylesheet (print/flow tweaks only). */
  extraCss?: string;
  /** Adds a reference to the footer. */
  footerReference?: string;
};

export function renderHospitalityQuoteDocument(snapshot: QuoteDocumentSnapshot, reference: { createdAt: string }, options: HospitalityQuoteDocumentOptions = {}) {
  const location = snapshot.service.roomOrArea || snapshot.service.floorLevel || snapshot.service.deliveryPoint || "Location to confirm";
  const dietaries = Object.entries(snapshot.dietaries).filter(([, value]) => value !== 0 && value !== "" && value !== false).map(([key, value]) => `<span>${quoteEsc(key)}: ${quoteEsc(value)}</span>`).join("") || `<span class="muted">None recorded</span>`;
  const branding = resolveQuoteBranding(snapshot.service);
  const body = options.bodyHtml ?? `<div class="section-title"><h2>Your hospitality service</h2><span class="small">Prices shown net of VAT</span></div>${quoteOrderTableHtml(snapshot.order.lines, snapshot.charges)}`;
  const siteRows = options.hideLocationAndGuests ? "" : `<div class="meta-row"><span class="meta-label">Location</span><span>${quoteEsc(branding.label)} · ${quoteEsc(location)}</span></div><div class="meta-row"><span class="meta-label">Guests</span><span>${quoteEsc(snapshot.service.guestCount)}</span></div>`;
  const vatLabel = options.vatLabel ?? `VAT (${Math.round(snapshot.totals.vatRate * 100)}%)`;
  const footer = `<footer class="footer">${options.footerReference ? `<span class="footer-reference">${quoteEsc(options.footerReference)}</span>` : ""}<span>FIKA Catering · Hospitality, elevated.</span><span>Generated ${quoteEsc(quoteDateTime(reference.createdAt))}</span></footer>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA Hospitality quotation</title><style>${FONT_CSS}${QUOTE_CSS}${options.extraCss ?? ""}</style></head><body><main class="page">${quoteMastheadHtml(branding)}<section class="intro"><div><div class="eyebrow">Prepared for</div><h1>${quoteEsc(snapshot.client.companyName)}</h1><p><strong>${quoteEsc(snapshot.client.name)}</strong></p><p class="email">${quoteEsc(snapshot.client.email)}${snapshot.client.phone ? ` · ${quoteEsc(snapshot.client.phone)}` : ""}</p><div class="rule"></div></div><div class="meta"><div class="meta-row"><span class="meta-label">Service</span><span>${quoteEsc(humanise(snapshot.order.eventType || "Hospitality"))}</span></div><div class="meta-row"><span class="meta-label">Date &amp; time</span><span>${quoteEsc(quoteDate(snapshot.service.eventDate))} · ${quoteEsc(snapshot.service.startTime)}${snapshot.service.endTime ? `–${quoteEsc(snapshot.service.endTime)}` : ""}</span></div>${siteRows}</div></section>${body}<section class="totals"><div class="totals-row"><span>Items</span><strong>${quoteGbp(snapshot.totals.itemsNet.amount)}</strong></div><div class="totals-row"><span>Additional charges</span><strong>${quoteGbp(snapshot.totals.chargesNet.amount)}</strong></div><div class="totals-row"><span>Total net</span><strong>${quoteGbp(snapshot.totals.net.amount)}</strong></div><div class="totals-row"><span>${vatLabel}</span><strong>${quoteGbp(snapshot.totals.vat.amount)}</strong></div><div class="totals-row gross"><span>Total to pay</span><strong>${quoteGbp(snapshot.totals.gross.amount)}</strong></div></section><section class="callout"><strong>Dietary requirements</strong><div class="dietaries">${dietaries}</div>${snapshot.notes ? `<div style="margin-top:12px"><strong>Notes</strong>${quoteEsc(snapshot.notes)}</div>` : ""}</section>${footer}</main></body></html>`;
}
