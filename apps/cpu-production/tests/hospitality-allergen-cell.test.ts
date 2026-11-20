import assert from "node:assert/strict";
import test from "node:test";
import { HospitalityAllergenCell } from "../app/ui/HospitalityAllergenCell";

test("shared CPU allergen box identifies the row and exposes the recorded state", () => {
  const cell = HospitalityAllergenCell({
    allergenKey: "gluten",
    label: "Gluten",
    rowName: "Fictional pastry",
    allergens: { gluten: "may_contain" },
    context: {},
    locked: true,
    onToggle: () => {},
  });
  assert.equal(cell.type, "button");
  assert.equal(cell.props["aria-label"], "Gluten for Fictional pastry: May Contain");
  assert.equal(cell.props["aria-pressed"], "mixed");
  assert.equal(cell.props["aria-disabled"], true);
  assert.equal(cell.props.children, undefined);
});
