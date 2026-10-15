import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bookingRequestedItems, bookingRoutingStatus, groupRequestedItems, NO_CPU_PRODUCTION_MESSAGE, productionRequirement, requestedItemLabel } from "../lib/booking-presentation";
import { RequestedItemsList } from "../app/ui/RequestedItemsList";
import type { CanonicalBooking } from "../lib/canonical-types";
import type { HospitalityBookingGroup, HospitalityGroupService } from "../../shared/hospitality-group-quotes";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const totals = (net: number) => ({ itemsNet: net, chargesNet: 0, net, vat: net * 0.2, gross: net * 1.2 });
const service = (bookingId: string, time: string, lines: Array<[string, number, number]>, status = "cpu_required"): HospitalityGroupService => ({
  bookingId, sourceReference: `ref-${bookingId}`, commercialVersion: 1, lifecycleStatus: "New", serviceType: "meeting_hospitality", time, location: "Room 2", guests: 25,
  lines: lines.map(([name, quantity, net]) => ({ name, quantity, unitNet: net / quantity, net })), charges: [], totals: totals(lines.reduce((sum, line) => sum + line[2], 0)),
  routing: { status, statusLabel: status, lines: lines.map((_, index) => ({ index, state: status, label: `line ${index}` })) },
});
// Deliberately out of time order to prove the view sorts and never relies on array order.
const services = [
  service("s-1300", "13:00", [["Deli Style Sandwich Lunch", 25, 250]]),
  service("s-0900", "09:00", [["House Filter Coffee", 25, 50], ["Mini Pastries", 3, 12]]),
  service("s-1500", "15:00", [["House Filter Coffee", 25, 50]], "no_cpu_production"),
  service("s-1100", "11:00", [["House Filter Coffee", 25, 50]], "no_cpu_production"),
];
const group = { kind: "booking-group", id: "g1", services, totals: totals(412) } as unknown as HospitalityBookingGroup;

test("all items from every service are listed together in service-time order, keeping per-service item order", () => {
  const rows = groupRequestedItems(group);
  assert.deepEqual(rows.map(requestedItemLabel), [
    "09:00 — 25 × House Filter Coffee", "09:00 — 3 × Mini Pastries", "11:00 — 25 × House Filter Coffee",
    "13:00 — 25 × Deli Style Sandwich Lunch", "15:00 — 25 × House Filter Coffee",
  ]);
  assert.equal(rows.length, services.reduce((sum, s) => sum + s.lines.length, 0));
});

test("service identity and commercial amounts stay on the rows; the presentation never mutates the group", () => {
  const before = structuredClone(group);
  const rows = groupRequestedItems(group);
  assert.deepEqual(group, before);
  assert.deepEqual(rows.map(row => row.serviceBookingId), ["s-0900", "s-0900", "s-1100", "s-1300", "s-1500"]);
  assert.equal(rows.reduce((sum, row) => sum + row.net, 0), services.flatMap(s => s.lines).reduce((sum, line) => sum + line.net, 0));
  assert.equal(group.totals.net, 412);
});

test("services that share a time keep their original relative order", () => {
  const rows = groupRequestedItems({ services: [service("a", "09:00", [["First", 1, 1]]), service("b", "09:00", [["Second", 1, 1]])] });
  assert.deepEqual(rows.map(row => row.name), ["First", "Second"]);
});

test("a single-service booking uses the same model with every row sharing one time", () => {
  const booking = { canonicalId: "b1", service: { startTime: "12:00" }, deliveryChargeRequired: true, order: { items: [
    { itemId: "i1", itemName: "Sandwiches", quantity: 10, unitPrice: 5, lineTotal: 50, servingInfo: "Cut in half" }, { itemId: "i2", quantity: 2, unitPrice: 3, lineTotal: 6, comments: "No nuts" }] } } as unknown as CanonicalBooking;
  const rows = bookingRequestedItems(booking);
  assert.deepEqual(rows.map(requestedItemLabel), ["12:00 — 10 × Sandwiches", "12:00 — 2 × i2"]);
  const html = renderToStaticMarkup(createElement(RequestedItemsList, { rows }));
  assert.match(html, /12:00 — 10 × Sandwiches/); assert.match(html, /Cut in half/); assert.match(html, /No nuts/); assert.match(html, /£50\.00/);
});

test("the list renders every service at once with no selection, tabs or expandable sections", () => {
  const html = renderToStaticMarkup(createElement(RequestedItemsList, { rows: groupRequestedItems(group) }));
  for (const label of ["09:00 — 25 × House Filter Coffee", "11:00 — 25 × House Filter Coffee", "13:00 — 25 × Deli Style Sandwich Lunch", "15:00 — 25 × House Filter Coffee"]) assert.ok(html.includes(label), label);
  assert.ok(html.indexOf("09:00") < html.indexOf("11:00") && html.indexOf("11:00") < html.indexOf("13:00") && html.indexOf("13:00") < html.indexOf("15:00"));
  assert.doesNotMatch(html, /<details|<summary|role="tab"|<button/);
});

test("mixed bookings keep non-CPU items visible while exposing production", () => {
  const rows = groupRequestedItems(group);
  assert.ok(rows.some(row => row.serviceBookingId === "s-1100") && rows.some(row => row.serviceBookingId === "s-1500"));
  assert.equal(productionRequirement(services.map(s => s.routing?.status)), "required");
});

test("production requirement is booking-level and derived only from canonical routing status", () => {
  assert.equal(productionRequirement(["no_cpu_production", "no_cpu_production"]), "none");
  assert.equal(productionRequirement(["no_cpu_production", "cpu_required"]), "required");
  assert.equal(productionRequirement(["cpu_required"]), "required");
  // Unresolved routing must not silently lock the existing safeguards away.
  assert.equal(productionRequirement(["no_cpu_production", "routing_required"]), "review");
  assert.equal(productionRequirement(["routing_conflict"]), "review");
  assert.equal(productionRequirement([undefined]), "review");
  assert.equal(productionRequirement([]), "review");
  assert.equal(bookingRoutingStatus({ deliveryChargeRequired: false }), "no_cpu_production");
  assert.equal(bookingRoutingStatus({ deliveryChargeRequired: true }), "cpu_required");
  assert.equal(bookingRoutingStatus({ cpuRouting: { status: "routing_conflict", statusLabel: "", lines: [] }, deliveryChargeRequired: false }), "routing_conflict");
});

test("dashboard locks CPU, allergen matrix and menu actions when nothing needs CPU, and acts per service when it does", () => {
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.match(dashboard, /requirement === "none"/);
  for (const text of ["CPU production locked", "Allergen matrix locked", "Menu generation locked", "NO_CPU_PRODUCTION_MESSAGE"]) assert.ok(dashboard.includes(text), text);
  assert.match(dashboard, /productionRequirement\(selectedGroup\.services\.map\(service => service\.routing\?\.status\)\) === "none"/);
  assert.match(dashboard, /groupChildren\.filter\(child => child\.requirement !== "none"\)/);
  // Production commands run against the service's own canonical booking, via the unchanged act/performAction path.
  assert.match(dashboard, /act\(action, child\.booking\)/);
  assert.match(dashboard, /production-handoff/);
  assert.match(NO_CPU_PRODUCTION_MESSAGE, /No CPU-produced items/);
  // The matrix/menu readiness lookups are skipped for bookings that never produce on CPU.
  assert.match(dashboard, /productionRequirement\(\[bookingRoutingStatus\(selected\)\]\) === "none" \? \[\]/);
});

test("quote and lifecycle code paths are not touched by the presentation refactor", () => {
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.match(dashboard, /action: "production-handoff"/);
  assert.match(dashboard, /generateGroupQuote/);
  assert.ok(!read("../lib/quote-document.ts").includes("booking-presentation"));
});
