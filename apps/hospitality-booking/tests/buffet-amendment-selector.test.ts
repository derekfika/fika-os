import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { hotForkBuffetMenu, HOT_FORK_BUFFET_SELECTION_CONTRACT } from "@fika/server-shared/hospitality-buffet-selection";
import type { CanonicalBooking } from "../lib/canonical-types";
import type { PortalMenuItem } from "../lib/mnk-contract";
register("data:text/javascript," + encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('/lib/hospitality-portal-catalogue.ts')) return { format: 'module', source: 'export async function loadHospitalityPortalMenu() { return { menu: globalThis.__amendmentMenu, catalogue: { source: "network" } }; } export function portalMenuFromCatalogue() { return globalThis.__amendmentMenu; }', shortCircuit: true };
  if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true };
  return next(url, context);
}`));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const React = await import("react");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { BuffetAmendmentSelector, buffetAmendmentIssue, storedBuffetPreview } = await import("../app/ui/BuffetAmendmentSelector");
const { GroupAmendmentEditor } = await import("../app/ui/GroupAmendmentEditor");
const { BookingAmendmentPanel } = await import("../app/ui/HospitalityDashboard");
afterEach(cleanup); after(() => dom.window.close());
const config = { ...hotForkBuffetMenu, readiness: { ...hotForkBuffetMenu.readiness, pendingRules: [], stagingCustomerSubmission: true }, packages: hotForkBuffetMenu.packages.map(pkg => ({ ...pkg, canonicalItemIds: [...pkg.canonicalItemIds] })), dishes: [...hotForkBuffetMenu.dishes] };
const gold = config.packages[0].canonicalItemIds[0]; const silver = config.packages[1].canonicalItemIds[0];
const item = (id: string, name: string, price: number): PortalMenuItem => ({ id, canonicalId: id, name, category: "Fork Buffet & Bowl Food", unitPrice: price, vatRate: null, dietaryInformation: [], allergenInformation: [] });
const eligible = (category: string) => config.dishes.filter(dish => dish.category === category && dish.selectionStatus === "source_listed");
const [meat] = eligible("meat"); const [veg] = eligible("vegetarian"); const salads = eligible("salad").slice(0, 3).map(dish => dish.id); const desserts = eligible("dessert").slice(0, 2).map(dish => dish.id);
const value = { contract: HOT_FORK_BUFFET_SELECTION_CONTRACT, menuVersion: config.menuVersion, rulesVersion: config.rulesVersion, packageId: "gold", mains: [{ dishId: meat.id, portions: 16 }, { dishId: veg.id, portions: 14 }], saladIds: salads, dessertIds: desserts };
const line = { itemId: gold, itemName: "Gold", unitPrice: 28, quantity: 30, lineTotal: 840, choices: [{ id: "ordinary", value: "kept" }, { id: "hot-fork-buffet-selection", value }] };
const original = { service: { guestCount: 30 }, order: { items: [line] } } as unknown as CanonicalBooking;

test("guest changes require valid explicit main allocations, preserving unchanged evidence", () => {
  assert.equal(buffetAmendmentIssue([line], 30, original), undefined);
  assert.match(buffetAmendmentIssue([line], 31, original)!, /guest count/i);
  const rescaled = { ...line, quantity: 31, choices: [line.choices[0], { id: "hot-fork-buffet-selection", value: { ...value, mains: [{ dishId: meat.id, portions: 16 }, { dishId: veg.id, portions: 15 }] } }] };
  assert.equal(buffetAmendmentIssue([rescaled], 31, original), undefined);
  assert.match(buffetAmendmentIssue([{ ...line, choices: [] }], 31, original)!, /silently removed/i);
  const legacy = { ...line, choices: [] };
  assert.equal(buffetAmendmentIssue([legacy], 31, { ...original, order: { ...original.order, items: [legacy] } }), undefined, "legacy menu-on-request is unchanged");
});

test("historical choice stays intact until a deliberate menu edit", () => {
  const legacy = { ...line, choices: [{ id: "hot-fork-buffet-selection", value: { contract: "fika.hot-fork-buffet-selection.v1", menuVersion: config.menuVersion, packageId: "gold", mains: value.mains, saladIds: salads, desserts: desserts.map(dishId => ({ dishId, portions: 15 })) } }] };
  assert.deepEqual(storedBuffetPreview(legacy)?.selection.dessertIds, desserts);
  const previous = { ...original, order: { ...original.order, items: [legacy] } };
  assert.equal(buffetAmendmentIssue([legacy], 30, previous), undefined);
  assert.match(buffetAmendmentIssue([legacy], 31, previous)!, /guest count/i);
});

test("edit saved selection, switch package, and retain unrelated choices and dietaries", () => {
  let result: typeof line | undefined; let notes = "";
  render(React.createElement(BuffetAmendmentSelector, { config, line, catalogue: [item(gold, "Gold", 28), item(silver, "Silver", 20)], selectedItemIds: [], guestCount: 31, dietaryNotes: "Original", onSave(next, value) { result = next as typeof line; notes = value; } }));
  assert.equal(storedBuffetPreview(line)?.selection.nonVegetarianMainId, meat.id);
  fireEvent.click(screen.getByRole("button", { name: "Edit menu" }));
  fireEvent.click(screen.getByRole("radio", { name: /Silver ·/ }));
  fireEvent.change(screen.getByRole("spinbutton", { name: veg.name }), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(eligible("dessert")[0].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
  fireEvent.change(screen.getByLabelText(/Dietary notes/), { target: { value: "Updated dietaries" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
  assert.ok(result); assert.equal(result!.itemId, silver); assert.equal(result!.quantity, 31); assert.equal(notes, "Updated dietaries");
  assert.deepEqual(result!.choices[0], { id: "ordinary", value: "kept" });
  assert.deepEqual((result!.choices[1] as { value: { dessertIds: string[] } }).value.dessertIds, [desserts[0]]);
});

test("All Day amendment sends the edited menu within its original service identity", async () => {
  const originalFetch = globalThis.fetch;
  const oldFlag = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
  const booking = { ...original, canonicalId: "service-1", version: 7, bookingGroup: { id: "group-1", sequence: 1, size: 1 }, service: { eventDate: "2027-01-20", startTime: "12:00", guestCount: 30 }, client: { name: "Fixture", companyName: "Fixture", email: "fixture@example.test" }, dietaries: { freeText: "Original" }, order: { eventType: "event_catering", items: [line] }, notes: "", deliveryChargeRequired: true };
  let payload: any; let cancelled = false;
  Object.assign(globalThis, { __amendmentMenu: [item(gold, "Gold", 28), item(silver, "Silver", 20)] });
  process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "true";
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") { payload = JSON.parse(String(init.body)); return Response.json({}); }
    if (String(url).includes("hospitality-buffet-selection")) return Response.json(config);
    return Response.json({ bookings: [booking], sourceHash: "source-v1" });
  };
  try {
    render(React.createElement(GroupAmendmentEditor, { group: { id: "group-1" } as never, site: "rcoa", oplocId: "oploc:test", onCancel() { cancelled = true; }, onSaved: async () => {}, onBusyChange() {} }));
    await screen.findByRole("button", { name: "Edit menu" });
    fireEvent.click(screen.getByRole("button", { name: "Edit menu" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    assert.equal(screen.queryByRole("dialog"), null); assert.equal(cancelled, false);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "31" } });
    assert.equal((screen.getByRole("spinbutton", { name: "Guests" }) as HTMLInputElement).value, "31");
    fireEvent.click(screen.getByRole("button", { name: "Edit menu" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: veg.name }), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    assert.equal(screen.queryByRole("dialog"), null);
    const vegetarian = screen.getByRole("spinbutton", { name: "Vegetarian" }) as HTMLInputElement; vegetarian.focus();
    fireEvent.change(vegetarian, { target: { value: "1" } });
    fireEvent.change(vegetarian, { target: { value: "12" } });
    assert.equal(document.activeElement === vegetarian, true);
    fireEvent.change(screen.getByLabelText("Reason for amendment"), { target: { value: "Guest count changed" } });
    fireEvent.submit(screen.getByRole("form", { name: "Amend All Day Hospitality booking" }));
    await waitFor(() => assert.ok(payload));
    assert.equal(payload.bookingGroupId, "group-1"); assert.equal(payload.expectedSourceHash, "source-v1");
    assert.equal(payload.services[0].bookingId, "service-1"); assert.equal(payload.services[0].expectedVersion, 7);
    assert.equal(payload.services[0].patch.dietaries.vegetarian, 12);
    const amended = payload.services[0].patch.order.items[0];
    assert.equal(amended.quantity, 31); assert.deepEqual(amended.choices[0], { id: "ordinary", value: "kept" });
    assert.equal(amended.choices[1].value.mains[1].portions, 15);
  } finally { globalThis.fetch = originalFetch; if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED; else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = oldFlag; }
});

test("standalone amendment requires allocation review and saves edited buffet details", async () => {
  const originalFetch = globalThis.fetch; const oldFlag = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
  const booking = { ...original, canonicalId: "standalone-1", lifecycleStatus: "Quoted", service: { eventDate: "2027-01-20", startTime: "12:00", guestCount: 30, portalSiteId: "rcoa", oplocId: "oploc:test", floorLevel: "Ground Floor", roomOrArea: "Conference Suite" }, client: { name: "Fixture", companyName: "Fixture", email: "fixture@example.test" }, dietaries: { freeText: "Original" }, order: { eventType: "event_catering", items: [line] }, notes: "", deliveryChargeRequired: true } as unknown as CanonicalBooking;
  let saved: any;
  Object.assign(globalThis, { __amendmentMenu: [item(gold, "Gold", 28), item(silver, "Silver", 20)] });
  process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "true";
  globalThis.fetch = async () => Response.json(config);
  function Harness() { const [draft, setDraft] = React.useState<React.ComponentProps<typeof BookingAmendmentPanel>["amendment"]>({ client: booking.client, service: booking.service, order: booking.order, notes: "", dietaries: booking.dietaries, deliveryChargeRequired: true, reason: "Guest count" }); return React.createElement(BookingAmendmentPanel, { siteKey: "rcoa", oplocId: "oploc:test", booking, amendment: draft, onChange: setDraft, onSave: () => { saved = draft; }, onCancel() {}, onKitchenNotesSaved() {} }); }
  try {
    render(React.createElement(Harness)); await screen.findByRole("button", { name: "Edit menu" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "31" } });
    fireEvent.submit(screen.getByRole("button", { name: /Save amendment/ }).closest("form")!);
    assert.match(screen.getByRole("alert").textContent!, /guest count/i); assert.equal(Boolean(saved), false);
    fireEvent.click(screen.getByRole("button", { name: "Edit menu" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: veg.name }), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/Dietary notes/), { target: { value: "Updated dietaries" } });
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    assert.equal(screen.queryByRole("dialog"), null);
    fireEvent.submit(screen.getByRole("button", { name: /Save amendment/ }).closest("form")!);
    assert.equal(saved.order.items[0].quantity, 31); assert.equal(saved.dietaries.freeText, "Updated dietaries");
  } finally { globalThis.fetch = originalFetch; if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED; else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = oldFlag; }
});

test("standalone buffet workflow stops after saving and requires explicit CPU handoff", () => {
  const source = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const saveAmendment = async");
  const handler = source.slice(start, source.indexOf("\n  };", start));
  assert.match(handler, /manualBuffetHandoff/);
  assert.match(handler, /if \(staffOverride \|\| manualBuffetHandoff\)[\s\S]*?return;/);
  assert.ok(handler.indexOf("if (staffOverride || manualBuffetHandoff)") < handler.indexOf('action: "production-handoff"'));
  assert.match(handler, /dietaries: amendment.dietaries/);
});
