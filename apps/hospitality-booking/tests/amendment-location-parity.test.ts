import assert from "node:assert/strict";
import { register } from "node:module";
import { after, afterEach, mock, test } from "node:test";
import { JSDOM } from "jsdom";
import type { ComponentProps } from "react";
import type { CanonicalBooking } from "../lib/canonical-types";
import { amendmentPatchDto } from "../lib/amendment-dto";
import { MUNICH_RE_LOCATIONS } from "../lib/munich-re-locations";

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

for (const admin of [false, true]) {
  test(`Munich RE ${admin ? "admin" : "manager"} switches a booking between rooms and collection points`, async () => {
    const service = await openPanel("munich-re", { roomOrArea: "Flex" }, admin);
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Meeting room or collection point" });
    assert.equal(select.value, "flex");
    assert.deepEqual(Array.from(select.options).slice(1).map(option => option.value), MUNICH_RE_LOCATIONS.map(location => location.id));
    assert.equal(screen.queryByRole("textbox", { name: "Delivery point" }), null);
    for (const [id, room, point] of [
      ["collection-level-5-cafe", "", "Collection from Level 5 Cafe"], ["acacia", "Acacia", ""],
    ]) {
      fireEvent.change(select, { target: { value: id } });
      const draft = service();
      const patch = amendmentPatchDto({ service: draft, client: { name: "Fixture", email: "staff@example.test", companyName: "Fixture" },
        order: { items: [], currency: "GBP", netTotal: 0, vatTotal: 0, grossTotal: 0 }, notes: "", deliveryChargeRequired: true,
        ...(admin ? { adminOplocId: "oploc:fixture" } : {}) });
      assert.equal(select.value, id);
      assert.deepEqual([patch.service.floorLevel, patch.service.roomOrArea, patch.service.deliveryPoint], ["", room, point]);
      assert.equal(draft.oplocId, "oploc:fixture");
      assert.equal("oplocId" in patch.service, false);
    }
  });
}

test("Munich RE retains historical location snapshots until a replacement is chosen", async () => {
  const location = { floorLevel: "Mezzanine", roomOrArea: "Old boardroom", deliveryPoint: "Historic foyer" };
  const service = await openPanel("munich-re", location);
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Meeting room or collection point" });
  assert.equal(select.value, "");
  assert.equal(select.selectedOptions[0].text, "Recorded location · Mezzanine · Old boardroom · Historic foyer");
  for (const key of Object.keys(location) as Array<keyof typeof location>) assert.equal(service()[key], location[key]);
  fireEvent.change(select, { target: { value: "aloe" } });
  assert.deepEqual([service().floorLevel, service().roomOrArea, service().deliveryPoint], ["", "Aloe", ""]);
});

test("another OPLOC does not inherit the Munich RE location directory", async () => {
  await openPanel("munich-re", { roomOrArea: "Acacia" }, true, "oploc:other");
  assert.equal(screen.queryByRole("combobox", { name: "Meeting room or collection point" }), null);
});
