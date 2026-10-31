import { seedVisibility } from "./support/rcoa-service-visibility";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { register } from "node:module";
import { JSDOM } from "jsdom";
import type { PortalMenuItem } from "../lib/mnk-contract";
import { createEmptyRcoaDraft } from "../lib/rcoa-portal";
import { createEmptyAllDay } from "../lib/rcoa-all-day";

register("data:text/javascript," + encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true };
  if (url.endsWith('/lib/hospitality-portal-catalogue.ts')) return { format: 'module', source: 'export async function loadHospitalityPortalMenu() { return { menu: globalThis.__guestTestMenu, catalogue: { source: "network" }, visibility: globalThis.__guestTestVisibility }; }', shortCircuit: true };
  return next(url, context);
}`));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
  CSS: { escape: (value: string) => value }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.scrollTo = () => {};
let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { requests++; throw new Error("Network forbidden in UI tests"); };
const React = await import("react");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { default: BookingPortal } = await import("../app/ui/BookingPortal");
const { default: RcoaBookingPortal } = await import("../app/ui/RcoaBookingPortal");
const { default: GuestCountInput } = await import("../app/ui/GuestCountInput");
const product = { id: "item:pack", canonicalId: "item:pack", name: "Pack", description: "", category: "Breakfast", unitPrice: 2, minimumQuantity: 8, governedConstraintsResolved: true } as PortalMenuItem;
const guestItem = { ...product, id: "item:event", canonicalId: "item:event", name: "Event selection", minimumGuests: 12 };
const selected = (item: PortalMenuItem = guestItem) => [{ itemId: item.id, quantity: 8, choices: {} }];
const contact = { requesterName: "Test", requesterEmail: "test@example.invalid", requesterPhone: "1", requesterCompany: "Test", clientName: "Test", clientCompany: "Test", invoiceReference: "PO1", specialInstructions: "" };
const acks = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
// Synthetic noon keeps UTC and Europe/London on the same business date around midnight/BST.
const future = new Date(); future.setUTCHours(12, 0, 0, 0); future.setUTCDate(future.getUTCDate() + 60);
while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1);
const serviceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(future);
const details = { eventDate: serviceDate, startTime: "09:00", endTime: "10:00", guestCount: 11, floorLevel: "1", roomOrArea: "Room", deliveryPoint: "" };
const sharedDraft = (step = 1, guests = 11, lines = selected()) => ({ step, occasion: "breakfast", category: "Breakfast", contact, details: { ...details, guestCount: guests }, lines, acks });
const rcoaDraft = (step = 2, guests = 11) => ({ ...createEmptyRcoaDraft(), step, occasion: "breakfast", contact: { name: "Test", email: "test@example.invalid", phone: "1", companyName: "Test", invoiceReference: "" }, event: { ...createEmptyRcoaDraft().event, ...details, guestCount: guests }, lines: selected(), acknowledgements: acks });
const guest = (surface = "booking", field = "guestCount") => document.querySelector<HTMLInputElement>(`[data-${surface}-field="${field}"]`)!;
const errorText = (input: HTMLInputElement) => (input.getAttribute("aria-describedby") || "").split(" ").map(id => document.getElementById(id)?.textContent).join(" ");
const restoreShared = (step = 1, guests = 11, lines = selected(), siteKey = "mnk") => dom.window.localStorage.setItem(`fika-hospitality-booking-draft:${siteKey}`, JSON.stringify(sharedDraft(step, guests, lines)));
const restoreRcoa = (step: number) => dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify(rcoaDraft(step)));
beforeEach(() => { dom.window.localStorage.clear(); dom.window.history.replaceState({}, "", "/"); requests = 0; Object.assign(globalThis, { __guestTestMenu: [product, guestItem], __guestTestVisibility: seedVisibility }); });
afterEach(() => { cleanup(); assert.equal(requests, 0, "no booking request or operational network write"); });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test("RCoA applies service visibility to tabs, retains a hidden saved line, and supports explicit keyboard removal", async () => {
  const wine = { ...product, id: "item:wine", canonicalId: "item:wine", name: "Wine", category: "Wine", minimumQuantity: 1 };
  Object.assign(globalThis, { __guestTestMenu: [{ ...product, category: "Drinks" }, wine], __guestTestVisibility: { ...seedVisibility, layout: { ...seedVisibility.layout, sites: { [seedVisibility.oplocId]: { breakfast: { categories: ["Drinks"] }, dining: { categories: ["Wine"] } } } } } });
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify({ ...rcoaDraft(3, 12), lines: [{ itemId: wine.id, quantity: 2, choices: {} }] }));
  render(React.createElement(RcoaBookingPortal, { configured: true }));
  const remove = await screen.findByRole("button", { name: "Remove Wine" });
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, false));
  assert.ok(screen.queryByRole("button", { name: "Drinks" }));
  assert.equal(screen.queryByRole("button", { name: "Wine" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  assert.ok(screen.getByRole("heading", { name: "Choose what feels right." }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("fika-rcoa-booking-draft:v1")!).lines.length, 1);
  await waitFor(() => assert.ok(document.activeElement === remove, `focus target: ${document.activeElement?.outerHTML.slice(0, 250)}`));
  await userEvent.setup({ document: dom.window.document }).keyboard("{Enter}");
  await waitFor(() => assert.equal(JSON.parse(dom.window.localStorage.getItem("fika-rcoa-booking-draft:v1")!).lines.length, 0));
});

test("RCoA missing service settings presents an accessible refresh action and prevents progression", async () => {
  Object.assign(globalThis, { __guestTestVisibility: undefined });
  render(React.createElement(RcoaBookingPortal, { configured: true }));
  await screen.findByRole("button", { name: "Refresh menu" });
  assert.ok(screen.getAllByRole("alert").some(alert => /settings could not be verified/.test(alert.textContent || "")));
  assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, true);
});

test("guest input allows blank edits, reports zero/decimal/blur errors, and supports keyboard correction without clamping", async () => {
  function Harness() { const [value, setValue] = React.useState(11); return React.createElement("label", {}, "Guests", React.createElement(GuestCountInput, { value, minimum: 12, field: "guestCount", surface: "booking", onChange: setValue })); }
  render(React.createElement(Harness)); const input = guest(); const user = userEvent.setup({ document: dom.window.document });
  assert.equal(input.min, "12"); assert.match(errorText(input), /at least 12/);
  await user.clear(input); assert.equal(input.value, ""); assert.equal(input.getAttribute("aria-invalid"), null);
  await user.tab(); assert.match(errorText(input), /at least 12/);
  await user.type(input, "0"); assert.equal(input.value, "0"); assert.equal(input.getAttribute("aria-invalid"), "true");
  fireEvent.change(input, { target: { value: "12.5" } }); assert.match(errorText(input), /whole number/);
  await user.clear(input); await user.type(input, "12"); assert.equal(input.value, "12"); assert.equal(input.getAttribute("aria-invalid"), null);
});

for (const siteKey of ["mnk", "angel-court", "cfc", "munich-re"] as const) {
  test(`${siteKey}: restored minimum is immediate; keyboard Continue blocks and corrected count progresses`, async () => {
    restoreShared(1, 11, selected(), siteKey); render(React.createElement(BookingPortal, { siteKey }));
    await waitFor(() => assert.equal(guest()?.min, "12")); const input = guest(); const user = userEvent.setup({ document: dom.window.document });
    assert.equal(input.value, "11"); assert.equal(input.getAttribute("aria-invalid"), "true"); assert.match(errorText(input), /12/);
    screen.getByRole("button", { name: "Continue" }).focus(); await user.keyboard("{Enter}");
    await waitFor(() => assert.ok(document.activeElement === input)); assert.equal(input.value, "11");
    await user.clear(input); await user.type(input, "12"); assert.equal(input.getAttribute("aria-invalid"), null);
    await user.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.equal(guest(), null));
  });
  test(`${siteKey}: quantity minimum 8 still permits one guest`, async () => {
    restoreShared(1, 1, selected(product), siteKey); render(React.createElement(BookingPortal, { siteKey }));
    await waitFor(() => assert.equal(guest()?.min, "1")); fireEvent.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.equal(guest(), null));
  });
}

test("shared portal recomputes Gallagher company/email context and clears stale inline errors", async () => {
  restoreShared(1, 1, selected(product), "angel-court"); render(React.createElement(BookingPortal, { siteKey: "angel-court" }));
  await waitFor(() => assert.equal(guest()?.min, "1"));
  fireEvent.change(document.querySelector('[data-booking-field="clientCompany"]')!, { target: { value: "Gallagher" } }); assert.equal(guest().min, "5"); assert.match(errorText(guest()), /5/);
  fireEvent.change(document.querySelector('[data-booking-field="clientCompany"]')!, { target: { value: "Test" } }); assert.equal(guest().min, "1"); assert.equal(guest().getAttribute("aria-invalid"), null);
  fireEvent.change(document.querySelector('[data-booking-field="requesterEmail"]')!, { target: { value: "test@redington.co.uk" } }); assert.equal(guest().min, "5");
});

for (const step of [2, 3, 4]) test(`shared step ${step}: invalid restored count blocks menu/Review/Submit and focuses Details`, async () => {
  restoreShared(step); render(React.createElement(BookingPortal, { siteKey: "mnk" })); await screen.findByRole("button", { name: "Edit guest count" });
  fireEvent.click(screen.getByRole("button", { name: step === 4 ? "Send request" : "Continue" }));
  await waitFor(() => assert.equal(guest()?.value, "11")); await waitFor(() => assert.ok(document.activeElement === guest()));
});

test("RCoA standard: menu edit link focuses the count; corrections clear immediately and preserve the entered value", async () => {
  restoreRcoa(3); render(React.createElement(RcoaBookingPortal, { configured: true })); fireEvent.click(await screen.findByRole("button", { name: "Edit guest count" }));
  await waitFor(() => assert.ok(document.activeElement === guest("rcoa"))); const input = guest("rcoa"); assert.equal(input.min, "12"); assert.equal(input.value, "11");
  fireEvent.change(input, { target: { value: "12" } }); assert.equal(input.getAttribute("aria-invalid"), null);
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.equal(guest("rcoa"), null));
});
for (const step of [4, 5]) test(`RCoA step ${step}: restored invalid count cannot reach Review or submit`, async () => {
  restoreRcoa(step); render(React.createElement(RcoaBookingPortal, { configured: true })); await screen.findByRole("button", { name: "Edit guest count" });
  fireEvent.click(screen.getByRole("button", { name: step === 5 ? "Send booking request" : "Continue" })); await waitFor(() => assert.equal(guest("rcoa")?.value, "11"));
});

test("RCoA All Day: service minima/counts stay independent; default 100 cannot mask failure and menu edit focuses its own row", async () => {
  const day = { ...createEmptyAllDay(), contact: rcoaDraft().contact, eventDate: details.eventDate, floorLevel: "1", defaultGuests: 100, acknowledgements: acks,
    services: [{ id: "one", category: "breakfast", startTime: "09:00", guestCount: 1, location: "Room A", lines: selected(product), notes: "" },
      { id: "two", category: "breakfast", startTime: "12:00", guestCount: 11, location: "Room B", lines: selected(), notes: "" }] };
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify({ flow: "all-day", allDay: day, step: 2 })); render(React.createElement(RcoaBookingPortal, { configured: true }));
  await waitFor(() => assert.equal(guest("rcoa", "guestCount:two")?.min, "12")); assert.equal(guest("rcoa", "guestCount:one").getAttribute("aria-invalid"), null); assert.equal(guest("rcoa", "guestCount:two").value, "11");
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.ok(document.activeElement === guest("rcoa", "guestCount:two")));
  fireEvent.click(screen.getAllByRole("button", { name: "Edit items" })[1]); fireEvent.click(await screen.findByRole("button", { name: "Edit service guest count" }));
  await waitFor(() => assert.ok(document.activeElement === guest("rcoa", "guestCount:two"))); fireEvent.change(guest("rcoa", "guestCount:two"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.equal(guest("rcoa", "guestCount:two"), null));
  const stored = JSON.parse(dom.window.localStorage.getItem("fika-rcoa-booking-draft:v1")!); assert.deepEqual(stored.allDay.services.map((service: { guestCount: number }) => service.guestCount), [1, 12]);
});

test("RCoA All Day: blank event default shows a linked error, blocks progression, then preserves service counts", async () => {
  const day = { ...createEmptyAllDay(), contact: rcoaDraft().contact, eventDate: details.eventDate, floorLevel: "1", defaultGuests: 0, acknowledgements: acks,
    services: [{ id: "one", category: "breakfast", startTime: "09:00", guestCount: 1, location: "Room A", lines: selected(product), notes: "" },
      { id: "two", category: "breakfast", startTime: "12:00", guestCount: 12, location: "Room B", lines: selected(guestItem), notes: "" }] };
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify({ flow: "all-day", allDay: day, step: 1 })); render(React.createElement(RcoaBookingPortal, { configured: true }));
  const input = guest("rcoa", "defaultGuests");
  assert.equal(input.value, ""); assert.equal(input.getAttribute("aria-invalid"), null);
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => assert.ok(document.activeElement === input));
  assert.equal(input.getAttribute("aria-invalid"), "true"); assert.match(errorText(input), /Enter at least 1 guest/);

  fireEvent.change(input, { target: { value: "50" } });
  assert.equal(input.getAttribute("aria-invalid"), null);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Build your day" });
  await waitFor(() => {
    const stored = JSON.parse(dom.window.localStorage.getItem("fika-rcoa-booking-draft:v1")!);
    assert.deepEqual(stored.allDay.services.map((service: { guestCount: number }) => service.guestCount), [1, 12]);
  });
});


test("shared menu selections recompute the requirement immediately and removal clears it without changing the guest count", async () => {
  restoreShared(2, 1, selected(product)); render(React.createElement(BookingPortal, { siteKey: "mnk" }));
  const quantity = await screen.findByRole("spinbutton", { name: "Event selection quantity" });
  assert.equal(screen.queryByRole("button", { name: "Edit guest count" }), null);
  fireEvent.change(quantity, { target: { value: "8" } });
  await screen.findByRole("button", { name: "Edit guest count" });
  fireEvent.change(quantity, { target: { value: "" } });
  assert.equal(screen.queryByRole("button", { name: "Edit guest count" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  assert.equal(guest().min, "1"); assert.equal(guest().value, "1");
});

test("blank shared input is allowed while editing and blocks Continue with linked error and focus", async () => {
  restoreShared(1, 12); render(React.createElement(BookingPortal, { siteKey: "mnk" }));
  await waitFor(() => assert.equal(guest()?.min, "12"));
  fireEvent.change(guest(), { target: { value: "" } }); assert.equal(guest().getAttribute("aria-invalid"), null);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => assert.ok(document.activeElement === guest()));
  assert.equal(guest().value, ""); assert.equal(guest().getAttribute("aria-invalid"), "true"); assert.match(errorText(guest()), /12/);
});

test("RCoA menu selections raise and remove their requirement immediately, allowing one guest for a quantity-only pack", async () => {
  const draft = rcoaDraft(3, 1); draft.lines = selected(product);
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify(draft)); render(React.createElement(RcoaBookingPortal, { configured: true }));
  const quantity = await screen.findByRole("spinbutton", { name: "Event selection quantity" });
  assert.equal(screen.queryByRole("button", { name: "Edit guest count" }), null);
  fireEvent.change(quantity, { target: { value: "8" } }); await screen.findByRole("button", { name: "Edit guest count" });
  fireEvent.change(quantity, { target: { value: "" } }); assert.equal(screen.queryByRole("button", { name: "Edit guest count" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); await screen.findByRole("heading", { name: "Help us look after everyone." });
});


test("RCoA standard recomputes Gallagher's guest policy from company/email and permits one guest when that context is removed", async () => {
  const draft = rcoaDraft(2, 1); draft.lines = selected(product);
  draft.contact.companyName = "Gallagher";
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify(draft)); render(React.createElement(RcoaBookingPortal, { configured: true }));
  await waitFor(() => assert.equal(guest("rcoa")?.min, "5")); assert.equal(guest("rcoa").value, "1");
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); assert.equal(guest("rcoa").getAttribute("aria-invalid"), "true");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.change(document.querySelector('[data-rcoa-field="companyName"]')!, { target: { value: "Test" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); assert.equal(guest("rcoa").min, "1"); assert.equal(guest("rcoa").value, "1"); assert.equal(guest("rcoa").getAttribute("aria-invalid"), null);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.change(document.querySelector('[data-rcoa-field="email"]')!, { target: { value: "test@redington.co.uk" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); assert.equal(guest("rcoa").min, "5");
});

test("RCoA All Day applies the current shared Gallagher identity to each row without using the event count", async () => {
  const day = { ...createEmptyAllDay(), contact: { ...rcoaDraft().contact, companyName: "Gallagher" }, eventDate: details.eventDate, floorLevel: "1", defaultGuests: 100, acknowledgements: acks,
    services: [{ id: "one", category: "breakfast", startTime: "09:00", guestCount: 5, location: "Room A", lines: selected(product), notes: "" },
      { id: "two", category: "breakfast", startTime: "12:00", guestCount: 1, location: "Room B", lines: selected(product), notes: "" }] };
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify({ flow: "all-day", allDay: day, step: 2 })); render(React.createElement(RcoaBookingPortal, { configured: true }));
  await waitFor(() => assert.equal(guest("rcoa", "guestCount:two")?.min, "5")); assert.equal(guest("rcoa", "guestCount:one").getAttribute("aria-invalid"), null);
  assert.equal(guest("rcoa", "guestCount:two").getAttribute("aria-invalid"), "true"); assert.equal(guest("rcoa", "guestCount:two").value, "1");
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); await waitFor(() => assert.ok(document.activeElement === guest("rcoa", "guestCount:two")));
  fireEvent.change(guest("rcoa", "guestCount:two"), { target: { value: "5" } }); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Help us look after everyone." });
});
