import assert from "node:assert/strict";
import { register } from "node:module";
import { after, afterEach, mock, test } from "node:test";
import { JSDOM } from "jsdom";
import type { ComponentProps } from "react";
import type { CanonicalBooking } from "../lib/canonical-types";

register("data:text/javascript," + encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true };
  if (url.endsWith('/lib/hospitality-portal-catalogue.ts')) return { format: 'module', source:
    'export async function loadHospitalityPortalMenu() { return { menu: [], catalogue: { source: "network", catalogue: {} } }; } export function portalMenuFromCatalogue() { return []; }',
    shortCircuit: true };
  return next(url, context);
}`));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
const React = await import("react");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { BookingAmendmentPanel } = await import("../app/ui/HospitalityDashboard");
const network = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
  assert.equal(init?.method ?? "GET", "GET");
  return new Response(null, { status: 404 });
});
type Props = ComponentProps<typeof BookingAmendmentPanel>;
type Location = Pick<Props["amendment"]["service"], "floorLevel" | "roomOrArea" | "deliveryPoint">;
afterEach(cleanup);
after(() => network.mock.restore());
after(() => dom.window.close());

async function openPanel(siteKey: Props["siteKey"], location: Location, admin = false, selectedOploc = "oploc:fixture") {
  const booking = {
    canonicalId: "booking:fixture", lifecycleStatus: "Quoted",
    client: { name: "Fixture", email: "fixture@example.test", companyName: "Fixture" },
    service: { eventDate: "2027-01-20", startTime: "12:00", guestCount: 4, portalSiteId: siteKey, oplocId: "oploc:fixture", ...location },
    order: { items: [] }, dietaries: {}, notes: "", deliveryChargeRequired: true,
  } as unknown as CanonicalBooking;
  let latest: Props["amendment"] = { client: booking.client, service: booking.service, order: booking.order, reason: "", notes: "", deliveryChargeRequired: true, ...(admin ? { adminOplocId: selectedOploc } : {}) };
  function Harness() {
    const [amendment, setAmendment] = React.useState(latest);
    return React.createElement(BookingAmendmentPanel, {
      siteKey, oplocId: selectedOploc, booking, amendment,
      onChange(next) { latest = next; setAmendment(next); },
      onSave() { assert.fail("Field edits must not submit the booking"); },
      onKitchenNotesSaved() { assert.fail("Field edits must not save kitchen notes"); },
      onCancel() {},
    });
  }
  await act(async () => { render(React.createElement(Harness)); });
  return () => latest.service;
}

const field = (name: string) => screen.getByRole<HTMLInputElement>("textbox", { name });
for (const site of ["angel-court", "mnk"] as const) {
  for (const admin of [false, true]) {
    test(`${site} ${admin ? "admin" : "manager"} amends three independent location fields`, async () => {
      const service = await openPanel(site, { deliveryPoint: "Service desk" }, admin);
      assert.deepEqual([field("Floor").value, field("Room / area").value, field("Delivery point").value], ["", "", "Service desk"]);
      fireEvent.change(field("Floor"), { target: { value: "Level 5" } });
      assert.equal(service().roomOrArea, undefined);
      assert.equal(service().deliveryPoint, "Service desk");
      fireEvent.change(field("Room / area"), { target: { value: "Room B" } });
      assert.equal(service().floorLevel, "Level 5");
      assert.equal(service().deliveryPoint, "Service desk");
      fireEvent.change(field("Delivery point"), { target: { value: "Reception" } });
      assert.deepEqual([service().floorLevel, service().roomOrArea, service().deliveryPoint], ["Level 5", "Room B", "Reception"]);
      assert.deepEqual([service().oplocId, service().portalSiteId], ["oploc:fixture", site]);
    });
  }
}

test("a different dashboard destination does not enable the site-specific controls", async () => {
  await openPanel("mnk", { floorLevel: "Level 3" }, false, "oploc:different");
  assert.equal(screen.queryByRole("textbox", { name: "Room / area" }), null);
  assert.equal(field("Floor, room or delivery point").value, "Level 3");
});
