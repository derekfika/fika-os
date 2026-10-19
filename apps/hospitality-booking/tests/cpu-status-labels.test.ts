import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HospitalityBookingGroup } from "../../shared/hospitality-group-quotes";
import { groupServiceStatusLabel, standaloneStatusLabel, planServiceProduction } from "../lib/cpu-production-plan";
import type { CanonicalBooking, ProductionOrder } from "../lib/canonical-types";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { HospitalityGroupDetail } = await import("../app/ui/HospitalityGroupDetail");
const { BookingProductionPanel } = await import("../app/ui/BookingProductionPanel");

const order = (status: string, quoteCurrent = true) => ({ orderId: "o", version: 1, sourceRevision: 1, status, quoteRevisionId: "q", quoteCurrent });
const totals = { gross: 20, net: 20, vat: 0, chargesNet: 0, itemsNet: 20 };
const service = (id: string, time: string, lifecycleStatus: string, production?: ReturnType<typeof order>) => ({ bookingId: id, lifecycleStatus, serviceType: "breakfast", time, location: "Hall", guests: 10, lines: [], charges: [], totals, ...(production ? { production } : {}) });

test("service status labels: Sent to CPU only for a live, current CPU order; everything else keeps its lifecycle wording", () => {
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Completed", production: order("draft") }), "Sent to CPU");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Completed", production: order("planned") }), "Sent to CPU");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Quoted" }), "Quoted", "in-house service unchanged");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Completed" }), "Completed", "no persisted order");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Completed", production: order("draft", false) }), "Completed", "stale order");
  for (const status of ["cancelled", "amended", "rejected"]) assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Completed", production: order(status) }), "Completed", status);
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Cancelled", production: order("cancelled") }), "Cancelled");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Cancelled", production: order("draft") }), "Cancelled", "a cancelled booking is never shown as sent");
  assert.equal(groupServiceStatusLabel({ lifecycleStatus: "Sent to CPU", production: order("draft") }), "Sent to CPU");
});

test("mixed three-service booking: CPU services read Sent to CPU, the in-house service stays Quoted, group status keeps its meaning", () => {
  const group = { kind: "booking-group", id: "group:test", reference: "RCOA-TEST", version: 1, sourceHash: "x", client: { name: "T", companyName: "Fixture", email: "t@example.test" }, eventDate: "2026-11-05", firstTime: "09:00", lastTime: "13:00", status: "Completed", totals, routing: { cpuServices: 2, inHouseServices: 1, warnings: 0 },
    services: [service("a", "09:00", "Completed", order("draft")), service("b", "11:00", "Quoted"), service("c", "13:00", "Completed", order("draft"))] } as unknown as HospitalityBookingGroup;
  const html = renderToStaticMarkup(createElement(HospitalityGroupDetail, { group, site: "rcoa", oplocId: "oploc:t", busy: false, onQuote() {}, onAmended: async () => {}, onBusyChange() {}, production: null }));
  const rows = [...html.matchAll(/<tr><th scope="row">.*?<\/tr>/g)].map(match => match[0]);
  assert.equal(rows.length, 3);
  assert.match(rows[0], />Sent to CPU</); assert.match(rows[1], />Quoted</); assert.match(rows[2], />Sent to CPU</);
  assert.ok(!rows.some(row => row.includes(">Completed<")));
  assert.match(html, /Booking status: Completed/, "group-level Completed is unchanged");
});

test("standalone: Completed with a live current order reads Sent to CPU; cancelled, missing or uncertain orders do not", () => {
  const booking = { canonicalId: "b", lifecycleStatus: "Completed", commercialVersion: 1, quoteState: { currentRevisionId: "q1", revisions: [{ id: "q1", revision: 1, createdAt: "t", commercialVersion: 1, stale: false, snapshot: {} }] } } as unknown as CanonicalBooking;
  const live = { canonicalId: "o", bookingId: "b", state: "Requested", sourceReferences: { quoteRevisionId: "q1" } } as unknown as ProductionOrder;
  assert.equal(standaloneStatusLabel(booking, live), "Sent to CPU");
  assert.equal(standaloneStatusLabel(booking, undefined), undefined);
  assert.equal(standaloneStatusLabel(booking, { ...live, state: "Cancelled" }), undefined);
  assert.equal(standaloneStatusLabel(booking, { ...live, state: "Uncertain" }), undefined);
  assert.equal(standaloneStatusLabel({ ...booking, lifecycleStatus: "Cancelled" } as CanonicalBooking, live), undefined);
  assert.equal(standaloneStatusLabel({ ...booking, lifecycleStatus: "Quoted" } as CanonicalBooking, live), undefined, "only the Completed wording is relabelled");
});

test("Production panel says Sent to CPU for handed-off services", () => {
  const sent = planServiceProduction as unknown;
  void sent;
  const rows = [{ bookingId: "a", label: "09:00 · Breakfast", requirement: "cpu", state: "sent", hasProductionOrder: true }, { bookingId: "b", label: "11:00 · Lunch", requirement: "none", state: "no_cpu", hasProductionOrder: false }] as never;
  const html = renderToStaticMarkup(createElement(BookingProductionPanel, { rows, results: {}, busy: false, onSend() {} }));
  assert.match(html, /Sent to CPU/); assert.doesNotMatch(html, />Sent</);
});
