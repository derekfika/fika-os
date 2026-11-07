import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import MockPage from "../app/mock/page";
import EmptyPreview from "../app/mock/EmptyPreview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixtureEvidence = /Espresso Martini|Strawberry Matcha|House Citrus Spritz|Autumn Spiced Cold Brew|Elderflower Fizz|Winter Orange Hot Chocolate|Butterfly Passion Cooler|Salted Caramel Latte|Munich RE|Commerzbank|One Angel Court|Angel Court|Optiver|2026|£\d|Demo session|Ready for approval|In prep/;
const button = (root: ReactTestInstance, label: string) => root.findAllByType("button").find(item => item.children.some(child => typeof child === "string" && child.includes(label)))!;
const content = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(content).join(" ");
const checkEmptyMetrics = (root: ReactTestInstance) => {
  const metrics = root.findAll(item => item.props.className === "m-metric");
  assert.equal(metrics.length, 4);
  for (const metric of metrics) {
    assert.match(content(metric), /Not connected/);
    assert.doesNotMatch(content(metric), /\b\d+\b/);
  }
};

test("the opt-in Target sites panel requests only the local read and clears site names when access fails", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(input, "/api/preview/oplocs");
    assert.deepEqual(init, { credentials: "same-origin", cache: "no-store", redirect: "error" });
    return calls === 1
      ? Response.json({ readOnly: true, oplocs: [{ id: "oploc:fixture-authorised", label: "Fictional authorised site" }] })
      : Response.json({ error: { code: "BEVERAGE_OPLOC_REQUEST_DENIED" } }, { status: 403 });
  });
  let rendered!: ReactTestRenderer;
  await act(async () => { rendered = create(createElement(EmptyPreview, { showHubSites: true })); });
  t.after(async () => { await act(async () => rendered.unmount()); });
  await act(async () => { button(rendered.root, "Monthly Specials").props.onClick(); });
  assert.equal(calls, 0);
  const check = () => button(rendered.root, "Check authorised sites").props.onClick();
  await act(async () => { await check(); });
  assert.match(JSON.stringify(rendered.toJSON()), /Fictional authorised site/);
  assert.equal(button(rendered.root, "Schedule special").props.disabled, true);
  await act(async () => { await check(); });
  assert.doesNotMatch(JSON.stringify(rendered.toJSON()), /Fictional authorised site/);
  assert.match(JSON.stringify(rendered.toJSON()), /Site access could not be authorised/);
  assert.equal(calls, 2);
});

test("staging presentation has an empty state and local mock keeps the approved fixture reference", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  try {
    process.env.FIKA_RUNTIME_MODE = "staging";
    const staging = renderToStaticMarkup(createElement(MockPage));
    assert.match(staging, /No Beverage records yet/);
    assert.doesNotMatch(staging, fixtureEvidence);
    process.env.FIKA_RUNTIME_MODE = "local";
    const local = renderToStaticMarkup(createElement(MockPage));
    assert.match(local, /Espresso Martini/);
    assert.match(local, /Munich RE/);
    assert.match(local, /Demo session/);
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = previous;
  }
});

test("staging navigation, empty specials and a blank editor stay in page memory", async t => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Preview must not fetch data"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  let rendered!: ReactTestRenderer;
  await act(async () => { rendered = create(createElement(EmptyPreview)); });
  t.after(() => { act(() => rendered.unmount()); });
  const checkNoFixtures = () => assert.doesNotMatch(JSON.stringify(rendered.toJSON()), fixtureEvidence);
  checkNoFixtures();
  checkEmptyMetrics(rendered.root);
  for (const destination of ["Drinks Library", "Recipe Cards", "Rollout", "Settings"]) {
    await act(async () => { button(rendered.root, destination).props.onClick(); });
    checkNoFixtures();
  }
  await act(async () => { button(rendered.root, "Monthly Specials").props.onClick(); });
  checkEmptyMetrics(rendered.root);
  await act(async () => { button(rendered.root, "Site view").props.onClick(); });
  assert.match(JSON.stringify(rendered.toJSON()), /No specials in site view/);
  checkNoFixtures();
  await act(async () => { button(rendered.root, "New Drink").props.onClick(); });
  assert.equal(button(rendered.root, "Save draft").props.disabled, true);
  assert.equal(button(rendered.root, "Submit for approval").props.disabled, true);
  await act(async () => { button(rendered.root, "Add ingredient").props.onClick(); });
  const name = rendered.root.findByProps({ "aria-label": "Ingredient 1 name" });
  assert.equal(name.props.value, "");
  await act(async () => { name.props.onChange({ target: { value: "Entered ingredient" } }); });
  assert.match(JSON.stringify(rendered.toJSON()), /Entered ingredient/);
  checkNoFixtures();
  for (const [label, value] of [["Ingredient 1 quantity", "2"], ["Ingredient 1 unit", "ml"], ["Ingredient 1 cost per unit", "0.25"]]) {
    await act(async () => { rendered.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } }); });
  }
  await act(async () => { rendered.root.findByProps({ id: "empty-preview-price" }).props.onChange({ target: { value: "1" } }); });
  assert.match(JSON.stringify(rendered.toJSON()), /50\.0%/);
  assert.equal(requests, 0);
});
