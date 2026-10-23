import assert from "node:assert/strict";
import test from "node:test";
import type { GrabAndGoProduct } from "../lib/grab-and-go";
import { mapStandingSlotProducts } from "../lib/grab-and-go-standing-copy";

const product = (productId: string, name: string, category: GrabAndGoProduct["category"], sortOrder: number): GrabAndGoProduct => ({
  productId, name, category, sortOrder, rotationWeeks: [1], allowedDeliveryWeekdays: ["Monday"], active: true,
});

test("maps quantities across recipe-specific IDs by governed category and stable catalogue position", () => {
  const source = [product("wk1-salad-a", "Week 1 Salad A", "stacking_salad_750ml", 20), product("wk1-pot-a", "Week 1 Pot A", "grab_250ml", 10)];
  const target = [product("wk3-pot-b", "Week 3 Pot B", "grab_250ml", 30), product("wk3-salad-b", "Week 3 Salad B", "stacking_salad_750ml", 40)];
  const result = mapStandingSlotProducts(source, target, { "wk1-pot-a": 15 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.mappings.map(item => [item.sourceProductId, item.targetProductId, item.quantity]), [
    ["wk1-pot-a", "wk3-pot-b", 15], ["wk1-salad-a", "wk3-salad-b", 0],
  ]);
});

test("rejects category-count differences rather than discarding or guessing quantities", () => {
  const result = mapStandingSlotProducts(
    [product("a", "Salad A", "stacking_salad_750ml", 1), product("b", "Salad B", "stacking_salad_750ml", 2)],
    [product("c", "Salad C", "stacking_salad_750ml", 1)],
    { a: 4, b: 7 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /different numbers/);
});

test("rejects unavailable saved products and ambiguous catalogue positions", () => {
  const source = [product("a", "Salad A", "stacking_salad_750ml", 1)];
  assert.equal(mapStandingSlotProducts(source, source, { retired: 3 }).ok, false);
  const ambiguous = [product("b", "Salad B", "stacking_salad_750ml", 1), product("c", "Salad C", "stacking_salad_750ml", 1)];
  const result = mapStandingSlotProducts(ambiguous, ambiguous, { b: 2 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /positions are not unique/);
});
