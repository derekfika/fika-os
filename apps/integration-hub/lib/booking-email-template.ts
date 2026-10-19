import type { CanonicalBooking } from "./hospitality-booking-service";
import type { BookingNotificationKind } from "./booking-notifications";
import { EMAIL_BRAND_PNG_BASE64 } from "./booking-email-brand-assets.generated";
import { HOSPITALITY_QUOTE_BRAND_CONFIG } from "../../shared/hospitality-quote-document";

/**
 * One reusable, table-based HTML template for the four customer lifecycle emails. It follows the hospitality quote PDF
 * (purple gradient masthead, FIKA logo left, site logo right, mint accent, same palette and hierarchy) using only
 * constructs Gmail and Outlook render: tables, inline styles, bgcolor fallbacks, PNG images referenced by cid:.
 * Site branding comes from the shared quote branding configuration; a site without artwork falls back to its text label.
 */
const C = { deep: "#24115c", purple: "#4f34c7", mint: "#4df7c2", ink: "#24163b", muted: "#665d73", line: "#e7e2f0", panel: "#faf9fd", page: "#eeeaf5" };
const FONT = "Gilroy,'Helvetica Neue',Helvetica,Arial,sans-serif";

export const EMAIL_FOOTER_MARKER = "<!--fika-contact-->";

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const present = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value) : "";

/** Date-only business dates are formatted as UK dates without timezone drift. */
export function ukDate(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return String(value || "");
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export type EmailBranding = { siteId: string; label: string; brand: string; logoKey?: string; reversedLogo: boolean };
export function resolveEmailBranding(service: CanonicalBooking["service"]): EmailBranding {
  const siteId = service.portalSiteId || "";
  const configured = Object.hasOwn(HOSPITALITY_QUOTE_BRAND_CONFIG, siteId) ? HOSPITALITY_QUOTE_BRAND_CONFIG[siteId] : undefined;
  const label = service.portalSiteLabel?.trim() || configured?.label || "";
  // The brand name carries the word "Hospitality" exactly once.
  const brand = label ? (/hospitality/i.test(label) ? label : `${label} Hospitality`) : "FIKA Hospitality";
  return { siteId, label: label || "Hospitality", brand, logoKey: Object.hasOwn(EMAIL_BRAND_PNG_BASE64, siteId) ? siteId : undefined, reversedLogo: Boolean(configured?.reversedLogo) };
}

type Copy = { subject: string; eyebrow: string; heading: string; pill: string; tone: "mint" | "amber" | "coral"; intro: string; closing: string; showItems: boolean };
function copyFor(kind: BookingNotificationKind, brand: string, date: string): Copy {
  switch (kind) {
    case "submitted": return { subject: `${brand} | Booking request received | ${date}`, eyebrow: "Booking request", heading: "We have received your request", pill: "Received · awaiting confirmation", tone: "amber", intro: "Thank you. Your hospitality request has been received and is subject to confirmation. Our team will review it and be in touch. Nothing is confirmed until you hear from us.", closing: "We will contact you once your request has been reviewed.", showItems: true };
    case "confirmed": return { subject: `${brand} | Booking confirmed | ${date}`, eyebrow: "Booking confirmation", heading: "Your booking is confirmed", pill: "Confirmed", tone: "mint", intro: "Thank you for choosing us. Your booking is confirmed with our team. Here is a summary of what we have booked in for you.", closing: "If anything needs changing before the service date, please let us know as soon as possible and we will do our best to help.", showItems: true };
    case "amended": return { subject: `${brand} | Booking updated | ${date}`, eyebrow: "Booking update", heading: "Your booking has been updated", pill: "Updated · subject to renewed confirmation", tone: "amber", intro: "Your booking has been changed. These are the latest details and they replace anything we sent before. This update is subject to renewed confirmation.", closing: "If anything here does not look right, please let us know as soon as possible.", showItems: true };
    default: return { subject: `${brand} | Booking cancelled | ${date}`, eyebrow: "Booking cancellation", heading: "Your booking has been cancelled", pill: "Cancelled", tone: "coral", intro: "This email confirms that the booking below has been cancelled. No further action is needed from you.", closing: "If you have any questions about this cancellation, please get in touch.", showItems: false };
  }
}
const TONE = { mint: { bg: "#e3fcf4", fg: "#0b6b4d", edge: C.mint }, amber: { bg: "#fff0ce", fg: "#704800", edge: "#f2b441" }, coral: { bg: "#ffe9e3", fg: "#9c2f12", edge: "#ff5c00" } };

function summaryRows(booking: CanonicalBooking) {
  const { service, client, order, source } = booking;
  const time = present(service.startTime) ? `${service.startTime}${present(service.endTime) ? ` – ${service.endTime}` : ""}` : "";
  const area = [service.floorLevel, service.roomOrArea, service.deliveryPoint].filter(present).filter((part, index, all) => all.indexOf(part) === index).join(" · ");
  const eventType = order.eventType || "";
  const type = eventType ? eventType.charAt(0).toUpperCase() + eventType.slice(1) : "";
  const rows: Array<[string, string]> = [["Reference", source.sourceBookingId], ["Company", client.companyName], ["Service", type], ["Date", ukDate(service.eventDate)], ["Time", time], ["Location", area], ["Guests", present(service.guestCount) && Number(service.guestCount) > 0 ? String(service.guestCount) : ""]];
  return rows.filter(([, value]) => present(value));
}

function itemLines(booking: CanonicalBooking) {
  return booking.order.items.filter(item => Number(item.quantity) > 0 || present(item.itemName)).map(item => {
    const unit = typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) ? item.unitPrice : undefined;
    const total = typeof item.lineTotal === "number" && Number.isFinite(item.lineTotal) ? item.lineTotal : unit !== undefined ? unit * Number(item.quantity) : undefined;
    return { name: item.itemName || item.itemId, quantity: Number(item.quantity), unit: unit === undefined ? "" : money(unit), total: total === undefined ? "" : money(total), totalValue: total, serving: item.servingInfo || "", comments: item.comments || "" };
  });
}

function totals(booking: CanonicalBooking, estimate: boolean, itemsNet: number | undefined) {
  const { netTotal, vatTotal, grossTotal } = booking.order;
  const rows: Array<[string, string, boolean]> = [];
  // Quote revisions can add charges that are not ordered items; show the difference so the totals reconcile with the lines above.
  if (typeof netTotal === "number" && Number.isFinite(netTotal) && itemsNet !== undefined && netTotal - itemsNet > 0.005) rows.push(["Additional charges", money(netTotal - itemsNet), false]);
  if (typeof netTotal === "number" && Number.isFinite(netTotal)) rows.push([estimate ? "Estimated subtotal" : "Subtotal", money(netTotal), false]);
  if (typeof vatTotal === "number" && Number.isFinite(vatTotal) && typeof netTotal === "number") rows.push(["VAT", money(vatTotal), false]);
  if (typeof grossTotal === "number" && Number.isFinite(grossTotal)) rows.push([estimate ? "Estimated total" : "Total", money(grossTotal), true]);
  return rows;
}

const cid = (key: string) => `cid:${key === "fika" ? "fika-logo" : `site-logo-${key}`}`;

function mastheadHtml(branding: EmailBranding) {
  const right = branding.logoKey
    ? `<img src="${cid(branding.logoKey)}" alt="${esc(branding.label)}" height="${branding.reversedLogo ? 44 : 40}" style="display:block;border:0;height:${branding.reversedLogo ? 44 : 40}px;width:auto;max-width:190px;${branding.reversedLogo ? "" : `background:#ffffff;padding:8px;border-radius:8px;`}">`
    : `<span style="font-family:${FONT};font-size:18px;font-weight:900;color:#ffffff;">${esc(branding.label)}</span>`;
  return `<tr><td bgcolor="${C.purple}" style="background-color:${C.purple};background-image:linear-gradient(118deg,${C.deep} 0%,${C.purple} 72%);padding:28px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="left" valign="middle"><img src="cid:fika-logo" alt="FIKA" width="126" style="display:block;border:0;width:126px;height:auto;"></td><td align="right" valign="middle">${right}</td></tr></table></td></tr>
<tr><td bgcolor="${C.mint}" height="4" style="height:4px;line-height:4px;font-size:0;background-color:${C.mint};">&nbsp;</td></tr>`;
}

export type BrandedBookingEmail = { subject: string; html: string; text: string };

export function renderBookingEmail(kind: BookingNotificationKind, booking: CanonicalBooking): BrandedBookingEmail {
  const branding = resolveEmailBranding(booking.service);
  const date = ukDate(booking.service.eventDate);
  const copy = copyFor(kind, branding.brand, date);
  const tone = TONE[copy.tone];
  const rows = summaryRows(booking);
  const items = copy.showItems ? itemLines(booking) : [];
  const sums = copy.showItems && items.length ? totals(booking, kind === "submitted", items.every(item => item.total) ? items.reduce((sum, item) => sum + (item.totalValue ?? 0), 0) : undefined) : [];
  const showPrices = items.some(item => item.unit || item.total);
  const greeting = present(booking.client.name) ? `Hi ${esc(booking.client.name)},` : "Hello,";

  const summaryHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.panel}" style="background-color:${C.panel};border:1px solid #ded8ed;border-radius:14px;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows.map(([label, value]) => `<tr><td valign="top" style="padding:6px 12px 6px 0;font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;color:${C.purple};white-space:nowrap;">${esc(label)}</td><td align="right" valign="top" style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink};">${esc(value)}</td></tr>`).join("")}</table></td></tr></table>`;

  const th = (label: string, align = "left") => `<th align="${align}" style="padding:10px 6px;border-bottom:2px solid ${C.purple};font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;color:${C.purple};text-align:${align};">${label}</th>`;
  const td = (inner: string, align = "left", extra = "") => `<td align="${align}" valign="top" style="padding:11px 6px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;color:${C.ink};text-align:${align};${extra}">${inner}</td>`;
  const itemsHtml = items.length ? `<h2 style="margin:28px 0 8px;font-family:${FONT};font-size:18px;line-height:1.2;color:${C.ink};">${kind === "submitted" ? "Your requested items" : "Your booked items"}</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${th("Qty", "center")}${th("Item")}${showPrices ? th("Unit", "right") + th("Total", "right") : ""}</tr>${items.map(item => `<tr>${td(esc(item.quantity), "center", "width:40px;font-weight:900;")}${td(`<span style="font-weight:900;">${esc(item.name)}</span>${item.serving ? `<br><span style="font-size:12px;color:${C.muted};">${esc(item.serving)}</span>` : ""}${item.comments ? `<br><span style="font-size:12px;color:${C.purple};">${esc(item.comments)}</span>` : ""}`)}${showPrices ? td(esc(item.unit), "right", "white-space:nowrap;color:" + C.muted + ";") + td(esc(item.total), "right", "white-space:nowrap;font-weight:900;") : ""}</tr>`).join("")}</table>
${sums.length ? `<table role="presentation" width="260" align="right" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;width:260px;">${sums.map(([label, value, strong]) => `<tr><td style="padding:${strong ? "9px" : "4px"} 0 4px;${strong ? `border-top:3px solid ${C.purple};` : ""}font-family:${FONT};font-size:${strong ? 16 : 14}px;color:${strong ? C.ink : C.muted};font-weight:${strong ? 900 : 400};">${esc(label)}</td><td align="right" style="padding:${strong ? "9px" : "4px"} 0 4px;${strong ? `border-top:3px solid ${C.purple};` : ""}font-family:${FONT};font-size:${strong ? 16 : 14}px;color:${C.ink};font-weight:900;white-space:nowrap;">${esc(value)}</td></tr>`).join("")}</table><div style="clear:both;"></div>` : ""}` : "";

  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background-color:${C.page};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background-color:#ffffff;border-radius:14px;overflow:hidden;">
${mastheadHtml(branding)}
<tr><td style="padding:30px 32px 8px;">
<div style="font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:${C.purple};">${esc(copy.eyebrow)}</div>
<h1 style="margin:8px 0 12px;font-family:${FONT};font-size:30px;line-height:1.05;letter-spacing:-0.5px;color:${C.ink};">${esc(copy.heading)}</h1>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${tone.bg}" style="background-color:${tone.bg};border-left:4px solid ${tone.edge};border-radius:6px;padding:6px 12px;font-family:${FONT};font-size:12px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;color:${tone.fg};">${esc(copy.pill)}</td></tr></table>
</td></tr>
<tr><td style="padding:18px 32px 30px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink};">
<p style="margin:0 0 12px;">${greeting}</p>
<p style="margin:0 0 20px;color:${C.muted};">${esc(copy.intro)}</p>
${summaryHtml}
${itemsHtml}
<p style="margin:28px 0 0;color:${C.muted};">${esc(copy.closing)}</p>
<p style="margin:20px 0 0;">Kind regards,<br><strong style="color:${C.purple};">${esc(branding.brand)}</strong></p>
</td></tr>
<tr><td style="padding:0 32px 26px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid ${C.line};padding-top:14px;font-family:${FONT};font-size:12px;line-height:1.5;color:#8a819d;">${EMAIL_FOOTER_MARKER}Questions? Simply reply to this email and the ${esc(branding.brand)} team will help.<br>Reference ${esc(booking.source.sourceBookingId)}</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    copy.heading.toUpperCase(), "", present(booking.client.name) ? `Hi ${booking.client.name},` : "Hello,", "", copy.intro, "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(items.length ? ["", kind === "submitted" ? "Requested items:" : "Booked items:", ...items.map(item => `- ${item.quantity} x ${item.name}${item.total ? ` (${item.total})` : ""}${item.serving ? ` — ${item.serving}` : ""}${item.comments ? ` — ${item.comments}` : ""}`)] : []),
    ...(sums.length ? ["", ...sums.map(([label, value]) => `${label}: ${value}`)] : []),
    "", copy.closing, "", "Kind regards,", branding.brand, "", `Questions? Simply reply to this email. Reference ${booking.source.sourceBookingId}`,
  ].join("\n");
  return { subject: copy.subject, html, text };
}

/** Inline PNG parts for every cid: reference in a message; sites resolve from the shared branding keys. */
export function emailInlineImages(html: string) {
  const keys = new Set<string>();
  for (const match of html.matchAll(/cid:(fika-logo|site-logo-[a-z0-9-]+)/g)) keys.add(match[1]);
  return [...keys].flatMap(contentId => {
    const key = contentId === "fika-logo" ? "fika" : contentId.slice("site-logo-".length);
    const base64 = Object.hasOwn(EMAIL_BRAND_PNG_BASE64, key) ? EMAIL_BRAND_PNG_BASE64[key] : undefined;
    return base64 ? [{ contentId, base64 }] : [];
  });
}
