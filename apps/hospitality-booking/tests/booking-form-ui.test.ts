import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BOOKING_NOTICE_SHORT } from "../lib/booking-notice";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { BookingDatePicker, ukLongBookingDate, tooltipFor, friendlyDates, spokenReasonFor } = await import("../app/ui/BookingDatePicker");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = "2026-10-20T09:00:00.000Z";

test("customer sandwich notice is the agreed concise wording and the portals no longer show the long policy text", () => {
  assert.equal(BOOKING_NOTICE_SHORT, "Orders require 2 preparation days’ notice before 12 noon, or 3 from 12 noon. Some items require longer notice.");
  for (const file of ["../app/ui/BookingPortal.tsx", "../app/ui/RcoaBookingPortal.tsx"]) {
    const source = read(file);
    assert.match(source, /BOOKING_NOTICE_SHORT/); assert.doesNotMatch(source, /\bSANDWICH_NOTICE\b/);
  }
  assert.match(read("../../../packages/server-shared/src/hospitality-booking-cutoffs.ts"), /export const SANDWICH_NOTICE = /, "the authoritative policy text is untouched");
});

test("dates are shown in readable UK format", () => {
  assert.equal(ukLongBookingDate("2026-10-23"), "Friday, 23 October 2026");
  assert.equal(ukLongBookingDate(""), ""); assert.equal(ukLongBookingDate("nonsense"), "");
});

test("date field renders as a labelled button, with no permanent calendar or instructional text", () => {
  const html = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-23", onChange() {}, items: [], now: NOW }));
  assert.match(html, /Delivery date/); assert.match(html, /Friday, 23 October 2026/); assert.match(html, /aria-haspopup="dialog"/); assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Selected:|Focus or tap|fika-date-popover|Saturday and Sunday/);
  const empty = renderToStaticMarkup(createElement(BookingDatePicker, { value: "", onChange() {}, items: [], now: NOW }));
  assert.match(empty, /Choose a date/);
});

test("a genuinely conflicting selected date shows a concise alert (weekend); an available one shows none", () => {
  const saturday = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-24", onChange() {}, items: [], now: NOW }));
  assert.match(saturday, /role="alert"/); assert.match(saturday, /aria-invalid="true"/);
  const friday = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-23", onChange() {}, items: [], now: NOW }));
  assert.doesNotMatch(friday, /role="alert"/);
});

test("form layout cannot stretch: items sit in an align-start grid, one per cell, and the calendar is a popover", () => {
  const css = read("../app/booking-date-picker.css");
  assert.match(css, /\.fika-form-grid \{[^}]*align-items: start/);
  assert.match(css, /\.fika-date-popover \{ position: absolute/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /:focus-visible/); assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  const portal = read("../app/ui/BookingPortal.tsx");
  const section = portal.slice(portal.indexOf("When and where?"), portal.indexOf("function Plan("));
  assert.match(section, /fika-form-grid/); assert.doesNotMatch(section, /className="fields"/);
  for (const field of ["eventDate", "guestCount", "startTime", "endTime", "location"]) assert.match(section, new RegExp(`ValidationMessage field="${field}"`));
  assert.doesNotMatch(css, /line-through/, "unavailable dates use muted colour, not strikethrough");
  const picker = read("../app/ui/BookingDatePicker.tsx");
  assert.match(picker, /fika-date-close/); assert.match(picker, />Close</); assert.match(picker, /aria-modal/);
  assert.match(picker, /PAST_DELIVERY_DATE/); assert.match(picker, /DELIVERY_WEEKEND/);
  const portals = read("../app/ui/BookingPortal.tsx") + read("../app/ui/RcoaBookingPortal.tsx");
  assert.doesNotMatch(portals, /We.ll confirm availability with you/); assert.doesNotMatch(portals, /Availability will be confirmed by the hospitality team/);
  assert.ok(!/[âˆ’−]{2,}/.test(portals) && !portals.includes("âˆ"), "no corrupted quantity symbols");
  assert.equal((portals.match(/&minus;<\/button>/g) || []).length, 2, "quantity decrement glyph is a safe HTML entity");
  for (const text of ["Escape", "ArrowDown", "PageDown", "createPortal", "aria-haspopup", "aria-live"]) assert.ok(picker.includes(text), text);
});

test("universal notice: with an EMPTY basket the picker's policy disables dates before the cutoff, with no sandwich wording", async () => {
  const { bookingDateIssue } = await import("@fika/server-shared/hospitality-effective-offering");
  const now = "2026-10-20T09:00:00.000Z"; // Tuesday 10:00 London, before noon
  const tomorrow = bookingDateIssue([], "2026-10-21", now);
  assert.equal(tomorrow?.code, "BOOKING_NOTICE");
  assert.ok(tomorrow?.earliestDate && tomorrow.earliestDate > "2026-10-21");
  assert.doesNotMatch(tomorrow!.message, /sandwich/i);
  assert.equal(bookingDateIssue([], tomorrow!.earliestDate!, now), undefined, "the earliest date offered is itself bookable");
  const html = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-21", onChange() {}, items: [], now }));
  assert.match(html, /role="alert"/); assert.doesNotMatch(html, /sandwich/i);
  for (const file of ["../app/ui/BookingPortal.tsx", "../app/ui/RcoaBookingPortal.tsx", "../lib/booking-notice.ts"]) assert.doesNotMatch(read(file), /Sandwich orders/);
  assert.equal(BOOKING_NOTICE_SHORT, "Orders require 2 preparation days’ notice before 12 noon, or 3 from 12 noon. Some items require longer notice.");
});

test("RCoA clears a stale event-date error when a valid date is chosen", () => {
  const source = read("../app/ui/RcoaBookingPortal.tsx");
  assert.match(source, /clearEventDateError/);
  assert.equal((source.match(/clearEventDateError\(\); \}\}/g) || []).length, 2, "both single and All Day pickers clear it");
});

test("tooltips: friendly UK dates, short weekend text, nothing for past dates, product reasons kept, no ISO dates", () => {
  assert.equal(tooltipFor({ code: "BOOKING_NOTICE", message: "Too soon for this booking. Earliest available delivery: 2026-10-23.", earliestDate: "2026-10-23" }), "Too soon — first available Fri 23 Oct");
  assert.equal(tooltipFor({ code: "DELIVERY_WEEKEND", message: "No deliveries on Saturdays or Sundays." }), "No weekend deliveries");
  assert.equal(tooltipFor({ code: "PAST_DELIVERY_DATE", message: "Choose a current or future delivery date." }), "");
  assert.equal(tooltipFor(undefined), "");
  const product = tooltipFor({ code: "PRODUCT_NOTICE", message: "This selection requires 240 hours notice. Earliest: 2026-11-03." });
  assert.match(product, /240 hours notice/); assert.doesNotMatch(product, /\d{4}-\d{2}-\d{2}/); assert.match(product, /Tue 3 Nov/);
  assert.equal(friendlyDates("No change here."), "No change here.");
});

test("calendar has no persistent footer explanation; the selected-date alert stays beside the input with friendly dates", () => {
  const picker = read("../app/ui/BookingDatePicker.tsx");
  assert.doesNotMatch(picker, /fika-date-reason/); assert.match(picker, /fika-date-tip/); assert.match(picker, /aria-hidden="true" data-below/);
  assert.match(picker, /onMouseEnter/); assert.match(picker, /onFocus=/); assert.match(picker, /setDismissed/);
  const html = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-21", onChange() {}, items: [], now: "2026-10-20T09:00:00.000Z" }));
  assert.match(html, /role="alert"/); assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}\./, "no ISO date in the visible conflict message");
  assert.match(html, /first available|Earliest available delivery: \w{3} \d/);
});

test("past dates: tooltip stays visually hidden but assistive technology gets a meaningful reason", () => {
  assert.equal(tooltipFor({ code: "PAST_DELIVERY_DATE", message: "x" }), "");
  assert.equal(spokenReasonFor({ code: "PAST_DELIVERY_DATE", message: "Choose a current or future delivery date." }), "Unavailable \u2014 this date has passed");
  assert.equal(spokenReasonFor({ code: "DELIVERY_WEEKEND", message: "m" }), "No weekend deliveries");
  assert.equal(spokenReasonFor(undefined), "Available");
  const html = renderToStaticMarkup(createElement(BookingDatePicker, { value: "2026-10-23", onChange() {}, items: [], now: "2026-10-20T09:00:00.000Z" }));
  assert.doesNotMatch(html, /fika-date-tip/, "no tooltip until an unavailable date is hovered or focused");
});

test("long tooltips wrap inside their background and are kept inside the calendar", () => {
  const css = read("../app/booking-date-picker.css");
  assert.match(css, /\.fika-date-tip \{[^}]*white-space: normal/); assert.match(css, /\.fika-date-tip \{[^}]*overflow-wrap: anywhere/); assert.match(css, /\.fika-date-tip \{[^}]*max-width: min\(240px/);
  assert.doesNotMatch(css, /\.fika-date-tip \{[^}]*white-space: nowrap/);
  const picker = read("../app/ui/BookingDatePicker.tsx");
  assert.match(picker, /useLayoutEffect/); assert.match(picker, /tipWidth \/ 2/);
});

