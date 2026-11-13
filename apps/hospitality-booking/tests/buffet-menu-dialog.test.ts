import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { register } from "node:module";
import { JSDOM } from "jsdom";
import type { BuffetMenu, BuffetSelection } from "../app/ui/BuffetMenuDialog";

register("data:text/javascript," + encodeURIComponent("export async function load(url, context, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => String(key) })', shortCircuit: true }; return next(url, context); }"));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const React = await import("react");
const { cleanup, fireEvent, render, screen, within, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { BuffetMenuDialog } = await import("../app/ui/BuffetMenuDialog");
const { BuffetMenuPicker } = await import("../app/ui/BuffetMenuPicker");
afterEach(cleanup); after(() => dom.window.close());

const menu: BuffetMenu = { version: "fixture", packages: [
  { id: "gold", label: "Gold", saladCount: 3, dessertCount: 2, mainMinimumPortions: 12, dessertAllocation: "equal-split", orderingReady: false, pendingRules: ["Some allocations need confirmation."] },
  { id: "silver", label: "Silver", saladCount: 3, dessertCount: 1, mainMinimumPortions: 12, dessertAllocation: "unconfirmed", orderingReady: false },
], dishes: [
  { id: "m", name: "Fixture meat", category: "meat" }, { id: "v", name: "Fixture vegetable", category: "vegetarian" },
  { id: "review", name: "Fixture under review", category: "vegan", selectionStatus: "review_required" },
  { id: "s1", name: "Fixture salad one", category: "salad" }, { id: "s2", name: "Fixture salad two", category: "salad" }, { id: "s3", name: "Fixture salad three", category: "salad" },
  { id: "d1", name: "Fixture dessert one", category: "dessert" }, { id: "d2", name: "Fixture dessert two", category: "dessert" },
] };
const choose = () => {
  fireEvent.click(screen.getByRole("radio", { name: /Fixture meat/ })); fireEvent.click(screen.getByRole("radio", { name: /Fixture vegetable/ }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture meat" }), { target: { value: "16" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture vegetable" }), { target: { value: "14" } });
  for (const name of ["Fixture salad one", "Fixture salad two", "Fixture salad three", "Fixture dessert one", "Fixture dessert two"]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
};

test("known choices validate, show live portions and save a draft that reopens", () => {
  let saved: BuffetSelection | undefined;
  const view = render(React.createElement(BuffetMenuDialog, { menu, guestCount: 30, initialPackageId: "gold", onSave: value => { saved = value; }, onCancel() {} }));
  assert.match(screen.getByRole("status").textContent!, /preview.*unavailable/i);
  assert.equal((screen.getByRole("radio", { name: /Fixture under review/ }) as HTMLInputElement).disabled, true);
  fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
  assert.match(screen.getByRole("alert").textContent!, /Choose one meat or fish main/);
  choose(); assert.match(screen.getByText("Main portions: 30 of 30 guests").textContent!, /30 of 30/);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture meat" }), { target: { value: "11" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selection" })); assert.match(screen.getByRole("alert").textContent!, /at least 12 portions/); assert.equal(Boolean(saved), false);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture meat" }), { target: { value: "16" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selection" })); assert.ok(saved);
  assert.deepEqual(saved!.saladIds, ["s1", "s2", "s3"]); assert.deepEqual(saved!.dessertIds, ["d1", "d2"]);
  view.unmount(); render(React.createElement(BuffetMenuDialog, { menu, guestCount: 30, initialPackageId: "gold", selection: saved, onSave() {}, onCancel() {} }));
  assert.equal((screen.getByRole("checkbox", { name: /Fixture salad one/ }) as HTMLInputElement).checked, true);
  assert.match(within(screen.getByRole("dialog")).getByText(/Fixture dessert one: 15 portions/).textContent!, /15 portions/);
});

test("odd equal split stays unallocated; switching package resets desserts", () => {
  let saved = false;
  render(React.createElement(BuffetMenuDialog, { menu, guestCount: 31, initialPackageId: "gold", selection: { packageId: "gold", nonVegetarianMainId: "m", vegetarianMainId: "v", mainPortions: { m: 16, v: 15 }, saladIds: ["s1", "s2", "s3"], dessertIds: ["d1", "d2"] }, onSave() { saved = true; }, onCancel() {} }));
  assert.match(screen.getByText(/Fixture dessert one: portions awaiting confirmation/).textContent!, /awaiting confirmation/);
  fireEvent.click(screen.getByRole("button", { name: "Save selection" })); assert.equal(saved, true, "odd guest totals can be saved as a local preview");
  fireEvent.click(screen.getByRole("radio", { name: "Silver" }));
  assert.equal((screen.getByRole("checkbox", { name: /Fixture dessert one/ }) as HTMLInputElement).checked, false);
  assert.ok(screen.getByRole("group", { name: /Desserts \(choose 1\)/ }));
});

test("Escape cancels and focus returns to the trigger; Tab stays in the dialog", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  function Harness() { const [open, setOpen] = React.useState(false); return React.createElement(React.Fragment, null, React.createElement("button", { onClick: () => setOpen(true) }, "Choose Menu"), open && React.createElement(BuffetMenuDialog, { menu, guestCount: 30, initialPackageId: "gold", onSave: () => setOpen(false), onCancel: () => setOpen(false) })); }
  render(React.createElement(Harness)); const trigger = screen.getByRole("button", { name: "Choose Menu" }); await user.click(trigger);
  assert.equal(document.activeElement, screen.getByRole("heading", { name: "Choose your menu" }));
  const last = screen.getByRole("button", { name: "Save selection" }); await user.tab({ shift: true }); assert.equal(document.activeElement, last);
  last.focus(); await user.tab(); assert.equal(document.activeElement, screen.getByRole("button", { name: "Close menu selector" }));
  await user.keyboard("{Escape}"); assert.equal(screen.queryByRole("dialog"), null); assert.equal(document.activeElement, trigger);
});




test("switching package keeps focus on the new basket item and saves notes", async () => {
  const config = { contract: "fika.hot-fork-buffet-menu.v1", menuVersion: "fixture", readiness: { customerSubmission: false, status: "pending_rules", pendingRules: [] }, packages: [
    { id: "gold", canonicalItemIds: ["gold-item"], rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 2, dessertAllocation: "equal-split", dessertMinimumPortions: "unconfirmed", oddGuestRounding: "unconfirmed" } },
    { id: "silver", canonicalItemIds: ["silver-item"], rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 1, dessertAllocation: "unconfirmed", dessertMinimumPortions: "unconfirmed", oddGuestRounding: "not_applicable" } },
  ], dishes: menu.dishes.map(dish => ({ ...dish, allergenStatus: "unrecorded", dietaryStatus: "unrecorded", selectionStatus: dish.selectionStatus === "review_required" ? "review_required" : "source_listed" })) } as import("../lib/buffet-menu-client").BuffetConfig;
  const items = [{ id: "gold-item", canonicalId: "gold-item", name: "Gold", category: "Buffet", unitPrice: 28, vatRate: null, dietaryInformation: [], allergenInformation: [] }, { id: "silver-item", canonicalId: "silver-item", name: "Silver", category: "Buffet", unitPrice: 20, vatRate: null, dietaryInformation: [], allergenInformation: [] }];
  let savedNotes = "";
  function Harness() { const [item, setItem] = React.useState<import("../lib/mnk-contract").PortalMenuItem>(items[0]); const [preview, setPreview] = React.useState<import("../lib/buffet-menu-client").BuffetPreview>(); return React.createElement(BuffetMenuPicker, { config, item, catalogue: items, selectedItemIds: [item.id], guestCount: 30, preview, dietaryNotes: "", onSave(target, next, notes) { savedNotes = notes; setItem(target); setPreview(next); } }); }
  render(React.createElement(Harness)); fireEvent.click(screen.getByRole("button", { name: "Choose Menu" }));
  fireEvent.click(screen.getByRole("radio", { name: /Silver ·/ }));
  fireEvent.click(screen.getByRole("radio", { name: /Fixture meat/ })); fireEvent.click(screen.getByRole("radio", { name: /Fixture vegetable/ }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture meat" }), { target: { value: "16" } }); fireEvent.change(screen.getByRole("spinbutton", { name: "Fixture vegetable" }), { target: { value: "14" } });
  for (const name of ["Fixture salad one", "Fixture salad two", "Fixture salad three", "Fixture dessert one"]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
  fireEvent.change(screen.getByLabelText(/Dietary notes/), { target: { value: "One dairy-free guest" } }); fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
  await waitFor(() => assert.equal(document.activeElement, screen.getByRole("button", { name: "Edit menu" })));
  assert.equal(savedNotes, "One dairy-free guest"); assert.ok(document.querySelector('[data-buffet-item-id="silver-item"]'));
});
