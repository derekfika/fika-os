import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SANDWICH_NOTICE_SHORT } from "../lib/booking-notice";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { BookingDatePicker, ukLongBookingDate } = await import("../app/ui/BookingDatePicker");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = "2026-10-20T09:00:00.000Z";

test("customer sandwich notice is the agreed concise wording and the portals no longer show the long policy text", () => {
  assert.equal(SANDWICH_NOTICE_SHORT, "Sandwich orders: 2 preparation days’ notice before 12 noon, or 3 from 12 noon. Some items require longer notice.");
  for (const file of ["../app/ui/BookingPortal.tsx", "../app/ui/RcoaBookingPortal.tsx"]) {
    const source = read(file);
    assert.match(source, /SANDWICH_NOTICE_SHORT/); assert.doesNotMatch(source, /\bSANDWICH_NOTICE\b/);
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
