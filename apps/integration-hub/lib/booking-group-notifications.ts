import { createHash } from "node:crypto";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { bookingNotificationRecord, configuredRecipients, type BookingNotificationKind, type BookingNotificationRecord } from "./booking-notifications";
import { C, FONT, TONE, copyFor, emailShellHtml, esc, money, present, resolveEmailBranding, ukDate, itemLines, type BrandedBookingEmail } from "./booking-email-template";
import { groupCommercialState, validateBookingGroup } from "./hospitality-group-commercial";

/**
 * Group-level customer notifications. The canonical service Bookings stay independent; one notification per group
 * lifecycle event is anchored to one affected child (its ID/version drive the existing delivery currency guard).
 * Pure functions only: every Firestore write happens inside the caller's authoritative transaction.
 */
export type GroupEmailInput = {
  kind: BookingNotificationKind;
  /** Every service of the group in its post-event state. */
  children: CanonicalBooking[];
  /** Services changed / newly cancelled by this event (amended, cancelled). */
  affected?: string[];
  /** Pre-event state of changed services, for the "what changed" lines. */
  previous?: Record<string, CanonicalBooking>;
};

const byTime = (a: CanonicalBooking, b: CanonicalBooking) => a.service.startTime.localeCompare(b.service.startTime) || (a.bookingGroup?.sequence || 0) - (b.bookingGroup?.sequence || 0);
const eventName = (children: CanonicalBooking[]) => children[0]?.notes?.match(/^Event: (.+)$/m)?.[1];
const typeLabel = (child: CanonicalBooking) => { const t = (child.order.eventType || "Hospitality").replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const timeLabel = (child: CanonicalBooking) => `${child.service.startTime}${present(child.service.endTime) ? ` – ${child.service.endTime}` : ""}`;
const place = (child: CanonicalBooking) => [child.service.floorLevel, child.service.roomOrArea, child.service.deliveryPoint].filter(present).filter((v, i, all) => all.indexOf(v) === i).join(" · ");

export function describeServiceChanges(before: CanonicalBooking, after: CanonicalBooking): string[] {
  const lines: string[] = [];
  if (before.service.startTime !== after.service.startTime || (before.service.endTime || "") !== (after.service.endTime || "")) lines.push(`Time: ${timeLabel(before)} → ${timeLabel(after)}`);
  if (before.service.guestCount !== after.service.guestCount) lines.push(`Guests: ${before.service.guestCount} → ${after.service.guestCount}`);
  if (place(before) !== place(after)) lines.push(`Location: ${place(before) || "not specified"} → ${place(after) || "not specified"}`);
  const key = (item: CanonicalBooking["order"]["items"][number]) => item.itemId;
  const was = new Map(before.order.items.filter(i => Number(i.quantity) > 0).map(i => [key(i), i] as const));
  const now = new Map(after.order.items.filter(i => Number(i.quantity) > 0).map(i => [key(i), i] as const));
  for (const [id, item] of now) { const old = was.get(id); const name = item.itemName || item.itemId; if (!old) lines.push(`Added: ${item.quantity} × ${name}`); else if (old.quantity !== item.quantity) lines.push(`Quantity: ${name} ${old.quantity} → ${item.quantity}`); else if (JSON.stringify(old.choices || []) !== JSON.stringify(item.choices || []) || (old.comments || "") !== (item.comments || "")) lines.push(`Options or notes changed: ${name}`); }
  for (const [id, item] of was) if (!now.has(id)) lines.push(`Removed: ${item.itemName || item.itemId}`);
  if ((before.notes || "") !== (after.notes || "")) lines.push("Booking notes updated");
  return lines;
}

function copyForGroup(input: GroupEmailInput, brand: string, date: string) {
  const ordered = [...input.children].sort(byTime);
  const total = ordered.length;
  const cancelled = ordered.filter(c => c.lifecycleStatus === "Cancelled");
  const active = total - cancelled.length;
  const affected = new Set(input.affected || []);
  const base = copyFor(input.kind, brand, date);
  const tail = (extra: string) => ({ ...base, intro: `${extra}`, showItems: true });
  switch (input.kind) {
    case "submitted": return { ...tail(`Thank you. Your hospitality request for ${total} services on ${date} has been received and is subject to confirmation. Our team will review it and be in touch. Nothing is confirmed until you hear from us.`) };
    case "confirmed": return { ...base, intro: `${active === total ? `All ${total} services` : `The ${active} active services`} below ${active === 1 ? "is" : "are"} confirmed with our team.${cancelled.length ? ` ${cancelled.length === 1 ? "One service was" : `${cancelled.length} services were`} previously cancelled and ${cancelled.length === 1 ? "is" : "are"} shown for reference.` : ""} Here is a summary of what we have booked in for you.`, showItems: true };
    case "amended": return { ...base, intro: `Your booking has been changed: ${affected.size} of ${total} services ${affected.size === 1 ? "was" : "were"} updated. The latest details for the whole booking are below and replace anything we sent before. This update is subject to renewed confirmation.`, showItems: true };
    default: {
      const now = ordered.filter(c => affected.has(c.canonicalId));
      if (active === 0) return { ...base, intro: `This email confirms that your booking, including ${total === 1 ? "its service" : `all ${total} services`}, has been cancelled. No further action is needed from you.`, showItems: false };
      return { ...base, subject: `${brand} | Booking partly cancelled | ${date}`, heading: "Part of your booking has been cancelled", pill: `Partly cancelled · ${active} ${active === 1 ? "service remains" : "services remain"} active`, tone: "amber" as const, intro: `${now.length} of ${total} services ${now.length === 1 ? "has" : "have"} been cancelled. The other ${active} ${active === 1 ? "service stays" : "services stay"} active and ${active === 1 ? "is" : "are"} unchanged.`, showItems: false };
    }
  }
}

function statusFor(kind: BookingNotificationKind, child: CanonicalBooking, affected: Set<string>) {
  const cancelled = child.lifecycleStatus === "Cancelled";
  if (kind === "cancelled") return cancelled ? (affected.has(child.canonicalId) ? "Cancelled" : "Cancelled earlier") : "Remains active";
  if (cancelled) return "Cancelled";
  if (kind === "amended") return affected.has(child.canonicalId) ? "Updated" : "Unchanged";
  return kind === "confirmed" ? "Confirmed" : "Requested";
}

export function renderGroupBookingEmail(input: GroupEmailInput): BrandedBookingEmail {
  const ordered = [...input.children].sort(byTime);
  const first = ordered[0];
  const branding = resolveEmailBranding(first.service);
  const date = ukDate(first.service.eventDate);
  const copy = copyForGroup(input, branding.brand, date);
  const tone = TONE[copy.tone];
  const affected = new Set(input.affected || []);
  const group = first.bookingGroup!;
  const showMoney = input.kind !== "cancelled";
  let commercial: ReturnType<typeof groupCommercialState> | undefined;
  if (showMoney) { try { commercial = groupCommercialState(group.id, ordered); } catch { commercial = undefined; } }
  const snapshotFor = (child: CanonicalBooking) => commercial?.snapshots[commercial.ordered.findIndex(c => c.canonicalId === child.canonicalId)];
  const rows: Array<[string, string]> = [["Booking reference", group.id], ["Company", first.client.companyName], ["Event", eventName(ordered) || ""], ["Date", date], ["Services", String(ordered.length)]].filter(([, v]) => present(v)) as Array<[string, string]>;
  const summaryHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.panel}" style="background-color:${C.panel};border:1px solid #ded8ed;border-radius:14px;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows.map(([label, value]) => `<tr><td valign="top" style="padding:6px 12px 6px 0;font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;color:${C.purple};white-space:nowrap;">${esc(label)}</td><td align="right" valign="top" style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink};">${esc(value)}</td></tr>`).join("")}</table></td></tr></table>`;

  const td = (inner: string, align = "left", extra = "") => `<td align="${align}" valign="top" style="padding:8px 6px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;color:${C.ink};text-align:${align};${extra}">${inner}</td>`;
  const th = (label: string, align = "left") => `<th align="${align}" style="padding:6px;border-bottom:2px solid ${C.purple};font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;color:${C.purple};text-align:${align};">${label}</th>`;
  const header = (prices: boolean) => `<tr>${th("Qty", "center")}${th("Item")}${prices ? th("Line total", "right") : ""}</tr>`;
  const sections = ordered.map(child => {
    const status = statusFor(input.kind, child, affected);
    const cancelled = child.lifecycleStatus === "Cancelled";
    const items = copy.showItems && !cancelled ? itemLines(child) : [];
    const charges = copy.showItems && !cancelled ? snapshotFor(child)?.charges || [] : [];
    const changes = input.kind === "amended" && affected.has(child.canonicalId) && input.previous?.[child.canonicalId] ? describeServiceChanges(input.previous[child.canonicalId], child) : [];
    const showPrices = items.some(i => i.total);
    const pillTone = status.startsWith("Cancelled") ? TONE.coral : status === "Updated" || status === "Requested" ? TONE.amber : status === "Confirmed" ? TONE.mint : { bg: C.panel, fg: C.muted };
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;border:1px solid #ded8ed;border-radius:14px;"><tr><td style="padding:14px 18px 6px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-family:${FONT};font-size:16px;font-weight:900;color:${C.ink};">${esc(timeLabel(child))} · ${esc(typeLabel(child))}</td><td align="right"><span style="font-family:${FONT};font-size:11px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;padding:3px 8px;border-radius:6px;background-color:${pillTone.bg};color:${pillTone.fg};">${esc(status)}</span></td></tr></table>
<div style="font-family:${FONT};font-size:13px;color:${C.muted};margin:2px 0 6px;">${esc([`${child.service.guestCount} guests`, place(child)].filter(present).join(" · "))}</div>
${changes.length ? `<div style="font-family:${FONT};font-size:13px;color:${C.purple};margin:4px 0 6px;"><strong>What changed:</strong><br>${changes.map(esc).join("<br>")}</div>` : ""}
${items.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${header(showPrices)}${items.map(i => `<tr>${td(esc(i.quantity), "center", "width:36px;font-weight:900;")}${td(`<span style="font-weight:900;">${esc(i.name)}</span>${i.serving ? `<br><span style="font-size:12px;color:${C.muted};">${esc(i.serving)}</span>` : ""}${i.comments ? `<br><span style="font-size:12px;color:${C.purple};">${esc(i.comments)}</span>` : ""}`)}${showPrices ? td(esc(i.total), "right", "white-space:nowrap;font-weight:900;") : ""}</tr>`).join("")}${charges.map(c => `<tr>${td("", "center")}${td(`<span style="font-weight:900;">${esc(c.label)}</span>${"detail" in c && c.detail ? `<br><span style="font-size:12px;color:${C.muted};">${esc(c.detail)}</span>` : ""}`)}${td(esc(money(c.net.amount)), "right", "white-space:nowrap;font-weight:900;")}</tr>`).join("")}</table>` : ""}
</td></tr></table>`;
  }).join("");

  const sums: Array<[string, string, boolean]> = [];
  if (commercial && showMoney) {
    const t = commercial.totals; const estimate = input.kind === "submitted";
    if (t.chargesNet > 0.005) sums.push(["Additional charges", money(t.chargesNet), false]);
    sums.push([estimate ? "Estimated subtotal" : "Subtotal", money(t.net), false], ["VAT", money(t.vat), false], [estimate ? "Estimated total" : "Total", money(t.gross), true]);
  }
  const sumsHtml = sums.length ? `<table role="presentation" width="260" align="right" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;width:260px;">${sums.map(([label, value, strong]) => `<tr><td style="padding:${strong ? "9px" : "4px"} 0 4px;${strong ? `border-top:3px solid ${C.purple};` : ""}font-family:${FONT};font-size:${strong ? 16 : 14}px;color:${strong ? C.ink : C.muted};font-weight:${strong ? 900 : 400};">${esc(label)}</td><td align="right" style="padding:${strong ? "9px" : "4px"} 0 4px;${strong ? `border-top:3px solid ${C.purple};` : ""}font-family:${FONT};font-size:${strong ? 16 : 14}px;color:${C.ink};font-weight:900;white-space:nowrap;">${esc(value)}</td></tr>`).join("")}</table><div style="clear:both;"></div>` : "";
  const itemsHtml = `<h2 style="margin:28px 0 0;font-family:${FONT};font-size:18px;line-height:1.2;color:${C.ink};">${input.kind === "cancelled" ? "Services in this booking" : input.kind === "submitted" ? "Your requested services" : "Your booked services"}</h2>${sections}${sumsHtml}`;
  const greeting = present(first.client.name) ? `Hi ${esc(first.client.name)},` : "Hello,";
  const html = emailShellHtml({ branding, copy, tone, greeting, summaryHtml, itemsHtml, reference: group.id });

  const text = [copy.heading.toUpperCase(), "", present(first.client.name) ? `Hi ${first.client.name},` : "Hello,", "", copy.intro, "", ...rows.map(([l, v]) => `${l}: ${v}`), "",
    ...ordered.flatMap(child => {
      const items = copy.showItems && child.lifecycleStatus !== "Cancelled" ? itemLines(child) : [];
      const charges = copy.showItems && child.lifecycleStatus !== "Cancelled" ? snapshotFor(child)?.charges || [] : [];
      const changes = input.kind === "amended" && affected.has(child.canonicalId) && input.previous?.[child.canonicalId] ? describeServiceChanges(input.previous[child.canonicalId], child) : [];
      return [`${timeLabel(child)} · ${typeLabel(child)} [${statusFor(input.kind, child, affected)}]`, `  ${[`${child.service.guestCount} guests`, place(child)].filter(present).join(" · ")}`, ...changes.map(c => `  Changed: ${c}`), ...items.map(i => `  - ${i.quantity} x ${i.name}${i.total ? ` (${i.total})` : ""}`), ...charges.map(c => `  - ${c.label} (${money(c.net.amount)})`), ""];
    }),
    ...sums.map(([l, v]) => `${l}: ${v}`), ...(sums.length ? [""] : []), copy.closing, "", "Kind regards,", branding.brand, "", `Questions? Simply reply to this email. Reference ${group.id}`].join("\n");
  return { subject: copy.subject, html, text };
}

const sanitize = (value: string) => value.replace(/[^A-Za-z0-9:_-]/g, "_");
export const groupEventKey = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
export const groupNotificationId = (groupId: string, kind: BookingNotificationKind, eventKey: string) => sanitize(`group:${groupId}:${kind}:${eventKey}`);

/**
 * Build the single customer notification for a group lifecycle event. `anchor` is an affected child whose current
 * ID/version/commercialVersion/OPLOC the existing delivery worker re-checks before sending (supersession, cancellation).
 */
export function groupNotificationRecord(input: GroupEmailInput & { anchor: CanonicalBooking; eventKey: string; createdAt: string; version?: number }): BookingNotificationRecord {
  const anchor = input.anchor;
  const base = bookingNotificationRecord(anchor, input.kind, input.version ?? anchor.version, input.createdAt);
  const email = renderGroupBookingEmail(input);
  const siteId = anchor.service.portalSiteId || "mnk";
  const cc = input.kind === "submitted" && siteId !== "rcoa" ? configuredRecipients(anchor.service.portalSiteId) : [];
  return { ...base, ...email, cc, templateKey: `${siteId}.group-${input.kind}.v1`, notificationId: groupNotificationId(anchor.bookingGroup!.id, input.kind, input.eventKey), bookingGroupId: anchor.bookingGroup!.id, groupBookingIds: [...input.children].sort(byTime).map(c => c.canonicalId) };
}

/**
 * Grouped services are ingested one at a time. The request-received email is created with the LAST service, in the
 * transaction that commits it: every earlier service returns undefined, so the customer receives exactly one.
 * An inconsistent group throws; the caller reports it and queues nothing.
 */
export function groupSubmittedNotification(booking: CanonicalBooking, siblings: CanonicalBooking[]): BookingNotificationRecord | undefined {
  const link = booking.bookingGroup;
  if (!link || link.size <= 1) return undefined;
  const all = [...siblings.filter(child => child.canonicalId !== booking.canonicalId), booking];
  if (all.length !== link.size) return undefined;
  const ordered = validateBookingGroup(link.id, all);
  return groupNotificationRecord({ kind: "submitted", children: ordered, anchor: ordered.find(child => child.bookingGroup!.sequence === 1) || ordered[0], eventKey: "v1", createdAt: booking.createdAt });
}
