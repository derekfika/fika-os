import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isCompleteOperationalAllergenMap, toggleOperationalAllergen } from "../../shared/allergen-contract";
import { cellLabel, cellState, emptyAllergens, hydrateSavedAllergens } from "../app/ui/allergen-cell-state";
import { mergeMissingProductionOrderLines } from "../app/lib/production-plan-state";

test("brand-new row has no recorded values and every cell is neutral", () => {
  const row = emptyAllergens();
  assert.deepEqual(row, {});
  for (const key of ["peanuts", "gluten", "no_key_allergens"]) {
    assert.equal(cellState(row, key), "unrecorded");
    assert.equal(cellLabel(cellState(row, key)), "");
  }
  assert.equal(isCompleteOperationalAllergenMap(row), false, "unrecorded must never count as reviewed clear");
});

test("server-seeded original row (allergens {}) stays neutral after hydration", () => {
  const plan = mergeMissingProductionOrderLines({ menuItems: [], status: "draft" } as never, "o1", [{ canonicalId: "l1", itemName: "Lunch", customerQuantity: 5 }]);
  assert.deepEqual(plan.menuItems[0].subItems[0].allergens, {});
});

test("saved item hydrates stored states exactly and keeps positive/may-contain", () => {
  const out = hydrateSavedAllergens({ peanuts: "contains", gluten: "may_contain", milk: "clear" });
  assert.equal(out.peanuts, "contains");
  assert.equal(out.gluten, "may_contain");
  assert.equal(out.milk, "clear");
  assert.equal(cellLabel(out.gluten), "MC");
  assert.equal(out.no_key_allergens, "clear");
});

test("saved item with missing values leaves them neutral, not clear", () => {
  const out = hydrateSavedAllergens({ peanuts: "contains" });
  assert.equal(cellState(out, "fish"), "unrecorded");
  assert.equal(cellState(out, "sesame"), "unrecorded");
  assert.deepEqual(hydrateSavedAllergens(undefined), {});
  assert.deepEqual(hydrateSavedAllergens({}), {});
});

test("an explicitly stored unrecorded state is preserved, never coerced to clear", () => {
  assert.equal(hydrateSavedAllergens({ peanuts: "unrecorded", fish: "clear" }).peanuts, "unrecorded");
});

test("first click from neutral advances to contains exactly once; cycle is unchanged", () => {
  let row = toggleOperationalAllergen(emptyAllergens(), "peanuts");
  assert.equal(row.peanuts, "contains");
  row = toggleOperationalAllergen(row, "peanuts");
  assert.equal(row.peanuts, "may_contain");
  row = toggleOperationalAllergen(row, "peanuts");
  assert.equal(row.peanuts, "clear");
});

test("No key allergens still explicitly selects and clears the named cells", () => {
  const row = toggleOperationalAllergen(emptyAllergens(), "no_key_allergens");
  assert.equal(row.no_key_allergens, "contains");
  assert.equal(row.peanuts, "clear");
  assert.equal(isCompleteOperationalAllergenMap(row), true);
});

test("save/reload round trip preserves exact states through JSON", () => {
  const original = toggleOperationalAllergen(hydrateSavedAllergens({ milk: "may_contain", eggs: "contains" }), "fish");
  const reloaded = hydrateSavedAllergens(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(reloaded, original);
});

test("unrecorded cell is styled neutral white in both stylesheet rules", async () => {
  const css = await readFile(new URL("../app/ui/hospitality-allergen-detail.css", import.meta.url), "utf8");
  assert.match(css, /\.allergen-cell--clear,\.allergen-cell--unrecorded\{background:#fff/);
  assert.match(css, /\.allergen-checker \.allergen-cell--unrecorded\{background:#fff/);
});

test("accessible name keeps unrecorded distinct from clear and unrecorded blocks completion", async () => {
  const src = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(src, /aria-label=\{`\$\{label\} for \$\{sub\.name \|\| "sub-item"\}: \$\{state\}`\}/);
  assert.match(src, /title=\{state === "unrecorded" \? "Not yet assessed" : undefined\}/);
  assert.equal(cellState({}, "milk"), "unrecorded");
  assert.equal(cellState({ milk: "clear" }, "milk"), "clear");
  assert.equal(isCompleteOperationalAllergenMap({ ...Object.fromEntries(["no_key_allergens","peanuts","tree_nuts","gluten","sesame","molluscs","fish","soya","celery","shellfish","eggs","milk","mustard","lupin","sulphites"].map(k => [k, "clear"])), milk: "unrecorded" }), false);
});
