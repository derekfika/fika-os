import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HospitalityBookingGroup } from "../../shared/hospitality-group-quotes";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const { HospitalityGroupDetail } = await import("../app/ui/HospitalityGroupDetail");
const { GroupItemChoices } = await import("../app/ui/GroupAmendmentEditor");
test("one grouped detail offers one amendment action and retains quote/run-sheet production entry points", () => {
  const group = { kind: "booking-group", id: "group:test", reference: "RCOA-TEST", version: 1, client: { name: "Test", companyName: "Fixture", email: "fixture@example.test" }, eventDate: "2026-11-05", firstTime: "09:00", lastTime: "15:00", status: "Ready for CPU", totals: { gross: 20, net: 20, vat: 0, chargesNet: 0, itemsNet: 20 }, services: [{ bookingId: "hidden-internal-identity", lifecycleStatus: "Quoted", serviceType: "breakfast", time: "09:00", guests: 10, lines: [{ name: "Pastries", quantity: 10, unitNet: 2, net: 20 }], charges: [], totals: { gross: 20, net: 20, vat: 0, chargesNet: 0, itemsNet: 20 } }] } as unknown as HospitalityBookingGroup;
  const html = renderToStaticMarkup(createElement(HospitalityGroupDetail, { group, site: "rcoa", oplocId: "oploc:test", busy: false, onQuote() {}, onAmended: async () => {}, onBusyChange() {}, production: createElement("p", {}, "Booking-level Production") }));
  assert.equal((html.match(/>Amend booking</g) || []).length, 1);
  assert.ok(html.includes("Generate group quote")); assert.ok(html.includes("Booking-level Production"));
  assert.ok(!html.includes("hidden-internal-identity"));
});
test("group item editing preserves the portal choice shape and marks mandatory options as required", () => {
  const html = renderToStaticMarkup(createElement(GroupItemChoices, { item: { itemId: "item", unitPrice: 2, quantity: 1, lineTotal: 2, choices: [{ id: "filling", value: "Salad" }] }, menuItem: { id: "item", canonicalId: "item", name: "Sandwich", category: "Lunch", unitPrice: 2, vatRate: 0.2, dietaryInformation: [], allergenInformation: [], optionGroups: [{ id: "filling", label: "Filling", selectionType: "single", required: true, options: [{ id: "salad", label: "Salad" }] }] }, onChange() {} }));
  assert.match(html, /Filling \(required\)/); assert.match(html, /required=""/); assert.match(html, /value="Salad" selected=""/);
});
test("group form saves once, includes every service version, and never offers individual service lifecycle actions", () => {
  const source = readFileSync(new URL("../app/ui/GroupAmendmentEditor.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/fetch\("\/api\/booking-groups\/amend"/g) || []).length, 1);
  for (const field of ["expectedSourceHash", "expectedVersion", "dietaries", "invoiceReference", "startTime", "endTime", "onsiteContactName", "quantity", "notes", "reason"]) assert.ok(source.includes(field), field);
  assert.doesNotMatch(source, /production-handoff|window\.(alert|prompt|confirm)/);
  assert.match(source, /lock.current/); assert.match(source, /disabled=\{saving\}/);
});
