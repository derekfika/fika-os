import assert from "node:assert/strict";
import test from "node:test";
import {
  assortmentTotal,
  groupSelectedDishes,
  moveGroupedDish,
  planningTarget,
  localDraftKey,
  moveDish,
  retainedDraftMatchesRequest,
} from "../components/studio-model";

test("section ordering preserves all IDs and leaves the source unchanged", () => {
  const original = ["a", "b", "c"];
  assert.deepEqual(moveDish(original, 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveDish(original, 1, 1), ["a", "c", "b"]);
  assert.deepEqual(original, ["a", "b", "c"]);
  assert.deepEqual(moveDish(original, 0, -1), original);
  assert.deepEqual(moveDish(original, 2, 1), original);
});

test("assortment counts sum components without conflating box count", () => {
  assert.equal(assortmentTotal([{ quantity: 10 }, { quantity: 14 }]), 24);
  assert.equal(assortmentTotal([]), 0);
});

test("acknowledgement clears only the exact retained snapshot", () => {
  const request = { id: "dish-a", version: 3, name: "First" };
  assert.equal(
    retainedDraftMatchesRequest(JSON.stringify(request), request),
    true,
  );
  assert.equal(
    retainedDraftMatchesRequest(
      JSON.stringify({ ...request, name: "Newer" }),
      request,
    ),
    false,
  );
  assert.equal(retainedDraftMatchesRequest(null, request), false);
});

test("editors have separate recovery keys for the same actor and entity", () => {
  assert.notEqual(
    localDraftKey("sam", "dish", "a", "editor-1"),
    localDraftKey("sam", "dish", "a", "editor-2"),
  );
});


test("grouping retains unavailable selections and separate veggie and vegan classifications", () => {
  const dishes = [{id: "v", category: "vegetarian"}, {id: "f", category: "fish"}, {id: "n", category: "vegan"}];
  const ids = ["v", "f", "n", "missing"];
  assert.deepEqual(groupSelectedDishes(ids, dishes), [
    {label: "Fish", ids: ["f"]}, {label: "Veggie / Vegan", ids: ["v", "n"]}, {label: "Not loaded", ids: ["missing"]},
  ]);
  assert.deepEqual(moveGroupedDish(ids, ["v", "n"], "v", 1), ["n", "f", "v", "missing"]);
  assert.deepEqual(ids, ["v", "f", "n", "missing"]);
  assert.deepEqual(moveGroupedDish(ids, ["v", "n"], "v", -1), ids);
});

test("planning targets are optional guidance only for recognised sections", () => {
  assert.equal(planningTarget(" Hot Fork Buffet "), "5 meat, 5 fish, 5 combined veggie / vegan, 12 salads and 12 desserts");
  assert.equal(planningTarget("Breakfast Pots"), "6 dishes");
  assert.equal(planningTarget("Special Breakfast Pots"), null);
});
