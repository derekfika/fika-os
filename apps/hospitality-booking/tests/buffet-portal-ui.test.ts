import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { register } from "node:module";
import { JSDOM } from "jsdom";
import { createEmptyRcoaDraft } from "../lib/rcoa-portal";
import { seedVisibility } from "./support/rcoa-service-visibility";

register("data:text/javascript," + encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true };
  if (url.endsWith('/lib/hospitality-portal-catalogue.ts')) return { format: 'module', source: 'export async function loadHospitalityPortalMenu() { return { menu: globalThis.__buffetTestMenu, catalogue: { source: "network" }, visibility: globalThis.__buffetTestVisibility }; }', shortCircuit: true };
  return next(url, context);
}`));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, CSS: { escape: (value: string) => value }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
dom.window.HTMLElement.prototype.scrollIntoView = () => {}; dom.window.scrollTo = () => {};
const React = await import("react");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { default: BookingPortal } = await import("../app/ui/BookingPortal");
const { default: RcoaBookingPortal } = await import("../app/ui/RcoaBookingPortal");
const item = { id: "gold-id", canonicalId: "gold-id", name: "Fixture Gold", category: "Fork Buffet & Bowl Food", unitPrice: 28, vatRate: null, minimumQuantity: 12, dietaryInformation: [], allergenInformation: [] };
const raw = { contract: "fika.hot-fork-buffet-menu.v1", menuVersion: "fixture-v1", rulesVersion: "rules-final", readiness: { customerSubmission: false, stagingCustomerSubmission: false, status: "rules_confirmed", pendingRules: [], liveOrderingApprovalRequired: true }, packages: [{ id: "gold", canonicalItemIds: ["gold-id"], rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 2, saladAllocation: "chef-discretion", dessertAllocation: "chef-discretion", dessertMinimumPortions: null, dessertIntent: "equal-split", sides: "included-in-mains", dietaryPortions: "within-guest-count" } }], dishes: [
  ["m", "meat", "Fixture meat"], ["v", "vegetarian", "Fixture vegetable"], ["s1", "salad", "Fixture salad one"], ["s2", "salad", "Fixture salad two"], ["s3", "salad", "Fixture salad three"], ["d1", "dessert", "Fixture dessert one"], ["d2", "dessert", "Fixture dessert two"],
].map(([id, category, name]) => ({ id, category, name, allergenStatus: "unrecorded", dietaryStatus: "unrecorded", selectionStatus: "source_listed" })) };
const preview = { menuVersion: "fixture-v1", rulesVersion: "rules-final", selection: { packageId: "gold", nonVegetarianMainId: "m", vegetarianMainId: "v", mainPortions: { m: 16, v: 14 }, saladIds: ["s1", "s2", "s3"], dessertIds: ["d1", "d2"] } };
const line = { itemId: item.id, quantity: 30, choices: {}, buffetPreview: preview };
const originalFetch = globalThis.fetch; const originalFlag = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
let posts = 0;
beforeEach(() => { posts = 0; dom.window.localStorage.clear(); process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "true"; Object.assign(globalThis, { __buffetTestMenu: [item], __buffetTestVisibility: seedVisibility }); globalThis.fetch = async (_url, init) => { if (init?.method === "POST") { posts++; throw new Error("POST forbidden"); } return Response.json(raw); }; });
afterEach(() => cleanup()); after(() => { globalThis.fetch = originalFetch; if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED; else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = originalFlag; dom.window.close(); });

test("MNK restores an editable menu preview and prevents submission", async () => {
  const contact = { requesterName: "Fixture", requesterEmail: "test@example.invalid", requesterPhone: "1", requesterCompany: "Test", clientName: "", clientCompany: "", invoiceReference: "", specialInstructions: "" };
  const details = { eventDate: "2027-01-20", startTime: "12:00", endTime: "13:00", guestCount: 30, floorLevel: "Ground", roomOrArea: "Room", deliveryPoint: "" };
  const acks = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
  dom.window.localStorage.setItem("fika-hospitality-booking-draft:mnk", JSON.stringify({ occasion: "event_catering", category: "Fork Buffet & Bowl Food", step: 2, contact, details, lines: [line], acks }));
  render(React.createElement(BookingPortal, { siteKey: "mnk" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit menu" }));
  assert.ok(screen.getByRole("dialog")); assert.equal((screen.getByRole("checkbox", { name: /Fixture salad one/ }) as HTMLInputElement).checked, true);
  fireEvent.change(screen.getByLabelText(/Dietary notes/), { target: { value: "Unsaved note" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  assert.notEqual(JSON.parse(dom.window.localStorage.getItem("fika-hospitality-booking-draft:mnk")!).dietaries.freeText, "Unsaved note");
  fireEvent.click(screen.getByRole("button", { name: "Edit menu" }));
  fireEvent.change(screen.getByLabelText(/Dietary notes/), { target: { value: "Saved dietary note" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("fika-hospitality-booking-draft:mnk")!).dietaries.freeText, "Saved dietary note");
  assert.ok(screen.getAllByText(/Fixture meat · 16 portions/).length);
  const draft = JSON.parse(dom.window.localStorage.getItem("fika-hospitality-booking-draft:mnk")!); draft.step = 4; dom.window.localStorage.setItem("fika-hospitality-booking-draft:mnk", JSON.stringify(draft)); cleanup(); render(React.createElement(BookingPortal, { siteKey: "mnk" }));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Send request" })));
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  assert.match(screen.getAllByText(/preview.*remove it or wait/i)[0].textContent!, /preview/i); assert.equal(posts, 0);
});

test("RCoA keeps the saved preview visible and blocks sending", async () => {
  const draft = { ...createEmptyRcoaDraft(), step: 5, occasion: "event_catering", lines: [line], event: { ...createEmptyRcoaDraft().event, eventDate: "2027-01-20", startTime: "12:00", guestCount: 30, floorLevel: "Ground Floor", roomOrArea: "Conference Suite" }, contact: { name: "Fixture", email: "test@example.invalid", phone: "1", companyName: "Test", invoiceReference: "" }, acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } };
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify(draft));
  render(React.createElement(RcoaBookingPortal, { configured: true }));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Send booking request" })));
  fireEvent.click(screen.getByRole("button", { name: "Send booking request" }));
  assert.match(screen.getAllByText(/preview.*remove it or wait/i)[0].textContent!, /preview/i); assert.equal(posts, 0);
});

test("MNK staging capability permits a structured buffet request", async () => {
  let payload: any;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { posts++; payload = JSON.parse(String(init.body)); return Response.json({ error: { message: "Fixture response" } }, { status: 503 }); }
    return Response.json({ ...raw, readiness: { ...raw.readiness, stagingCustomerSubmission: true } });
  };
  const contact = { requesterName: "Fixture", requesterEmail: "test@example.invalid", requesterPhone: "1", requesterCompany: "Test", clientName: "", clientCompany: "", invoiceReference: "", specialInstructions: "" };
  const details = { eventDate: "2027-01-20", startTime: "12:00", endTime: "13:00", guestCount: 30, floorLevel: "Ground", roomOrArea: "Room", deliveryPoint: "" };
  const acks = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
  dom.window.localStorage.setItem("fika-hospitality-booking-draft:mnk", JSON.stringify({ occasion: "event_catering", category: "Fork Buffet & Bowl Food", step: 4, contact, details, lines: [line], acks }));
  render(React.createElement(BookingPortal, { siteKey: "mnk" }));
  await waitFor(() => assert.ok(screen.getAllByText(/Fixture meat · 16 portions/).length));
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => assert.equal(posts, 1));
  const choice = payload.order.items[0].choices.find((value: any) => value.id === "hot-fork-buffet-selection");
  assert.equal(choice.value.contract, "fika.hot-fork-buffet-selection.v2");
  assert.deepEqual(choice.value.dessertIds, ["d1", "d2"]);
  assert.equal("desserts" in choice.value, false);
});

test("RCoA staging capability permits a structured buffet request", async () => {
  let payload: any;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { posts++; payload = JSON.parse(String(init.body)); return Response.json({ error: { message: "Fixture response" } }, { status: 503 }); }
    return Response.json({ ...raw, readiness: { ...raw.readiness, stagingCustomerSubmission: true } });
  };
  const draft = { ...createEmptyRcoaDraft(), step: 5, occasion: "event_catering", lines: [line], event: { ...createEmptyRcoaDraft().event, eventDate: "2027-01-20", startTime: "12:00", guestCount: 30, floorLevel: "Ground Floor", roomOrArea: "Conference Suite" }, contact: { name: "Fixture", email: "test@example.invalid", phone: "1", companyName: "Test", invoiceReference: "" }, acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } };
  dom.window.localStorage.setItem("fika-rcoa-booking-draft:v1", JSON.stringify(draft));
  render(React.createElement(RcoaBookingPortal, { configured: true }));
  await waitFor(() => assert.ok(screen.getAllByText(/Fixture meat · 16 portions/).length));
  fireEvent.click(screen.getByRole("button", { name: "Send booking request" }));
  await waitFor(() => assert.equal(posts, 1));
  const choice = payload.order.items[0].choices.find((value: any) => value.id === "hot-fork-buffet-selection");
  assert.equal(choice.value.contract, "fika.hot-fork-buffet-selection.v2");
  assert.deepEqual(choice.value.dessertIds, ["d1", "d2"]);
  assert.equal("desserts" in choice.value, false);
});
