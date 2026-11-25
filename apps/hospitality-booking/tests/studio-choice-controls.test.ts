import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { renderStudioDishChoiceControls } from "../../shared/hospitality-menu-studio-choice-controls";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const React = await import("react");
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
afterEach(cleanup); after(() => dom.window.close());
const dishes = [{ id: "a", name: "Same name", description: "First" }, { id: "b", name: "Same name", description: "Second" }];

test("shared dropdown sends stable dish IDs and enables quantity only after selection", () => {
  let selected = "", quantity = 0;
  const draw = () => React.createElement(React.Fragment, null, ...renderStudioDishChoiceControls(React.createElement, {
    label: "Dishes", presentation: "dropdown", dishes, quantities: {}, dropdownChoices: { "studio-flat": selected },
    onDropdownChange: (_group, id) => { selected = id; }, onQuantityChange: (_id, value) => { quantity = value; },
  }));
  const view = render(draw());
  assert.equal((screen.getByRole("spinbutton", { name: "Quantity" }) as HTMLInputElement).disabled, true);
  fireEvent.change(screen.getByRole("combobox", { name: "Dish" }), { target: { value: "b" } });
  assert.equal(selected, "b");
  view.rerender(draw());
  assert.match(screen.getByText("Second").textContent!, /Second/);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "3" } });
  assert.equal(quantity, 3);
});

test("shared grouped quantities render in the saved group order", () => {
  let selected = "";
  render(React.createElement(React.Fragment, null, ...renderStudioDishChoiceControls(React.createElement, {
    label: "Dishes", presentation: "quantities", dishes, quantities: {},
    groups: [{ id: "second", name: "Second group", presentation: "quantities", dishIds: ["b"] }, { id: "first", name: "First group", presentation: "quantities", dishIds: ["a"] }],
    onQuantityChange: (id) => { selected = id; },
  })));
  assert.deepEqual(screen.getAllByRole("group").map(group => group.querySelector("legend")?.textContent), ["Second group", "First group"]);
  fireEvent.change(screen.getAllByRole("spinbutton", { name: "Same name quantity" })[0], { target: { value: "4" } });
  assert.equal(selected, "b");
});
