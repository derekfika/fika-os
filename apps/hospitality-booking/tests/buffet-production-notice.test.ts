import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalBooking } from "../lib/canonical-types";
register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { ProductionReplacementNotice } = await import("../app/ui/ProductionReplacementNotice");
test("a retired buffet order shows persistent explicit replacement instructions", () => {
  const booking = { dashboardWorkflow: { productionReplacement: { status: "send_to_cpu_required", retiredOrderIds: ["order-1"], recordedAt: "2026-11-13T00:00:00Z", sourceBookingVersion: 2 } } } as CanonicalBooking;
  const html = renderToStaticMarkup(createElement(ProductionReplacementNotice, { booking, serviceLabel: "12:00 · lunch" }));
  assert.match(html, /12:00 · lunch: replacement required/); assert.match(html, /previous CPU order was retired/i); assert.match(html, /Generate the current quote/); assert.match(html, /Send to CPU/); assert.match(html, /not been sent automatically/);
  assert.equal(renderToStaticMarkup(createElement(ProductionReplacementNotice, { booking: {} as CanonicalBooking })), "");
  assert.equal(renderToStaticMarkup(createElement(ProductionReplacementNotice, { booking: { ...booking, lifecycleStatus: "Cancelled" } })), "");
});
