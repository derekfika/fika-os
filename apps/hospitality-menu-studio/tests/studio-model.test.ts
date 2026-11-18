import assert from "node:assert/strict";
import test from "node:test";
import {
  assortmentTotal,
  checkerHandoff,
  dishReviewStatus,
  ReviewResponseGuard,
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


test("checker status rejects unsupported or malformed results", () => {
  for (const status of ["unverified", "in_review", "verified", "revoked"] as const) assert.equal(dishReviewStatus({ status }), status);
  assert.equal(dishReviewStatus({ status: "approved" }), "unavailable");
  assert.equal(dishReviewStatus({}), "unavailable");
  assert.equal(dishReviewStatus(null), "unavailable");
});

test("checker handoff binds the saved subject and accepts only the exact local URL", () => {
  const subject = { dishId: "dish:one", revision: 2, sourceHash: "a".repeat(64) };
  const checkerPath = "/allergens/studio/dish%3Aone/2";
  const valid = { subject, checkerPath, checkerUrl: "http://127.0.0.1:13486" + checkerPath };
  assert.deepEqual(checkerHandoff(valid, subject.dishId, 2), { acknowledged: true, url: valid.checkerUrl });
  assert.deepEqual(checkerHandoff(valid, subject.dishId, 3), { acknowledged: false });
  assert.deepEqual(checkerHandoff({ ...valid, subject: { ...subject, sourceHash: "invalid" } }, subject.dishId, 2), { acknowledged: false });
  assert.deepEqual(checkerHandoff({ ...valid, checkerPath: "/other" }, subject.dishId, 2), { acknowledged: false });
  for (const checkerUrl of ["https://example.com" + checkerPath, "http://127.0.0.1:13486" + checkerPath + "?next=x", "http://user@localhost:13486" + checkerPath, "http://localhost:13486/other"]) {
    assert.deepEqual(checkerHandoff({ ...valid, checkerUrl }, subject.dishId, 2), { acknowledged: true });
  }
  assert.deepEqual(checkerHandoff({ subject, checkerPath }, subject.dishId, 2), { acknowledged: true });
});


test("late checker responses cannot follow a changed draft, subject or newer request", () => {
  const guard = new ReviewResponseGuard();
  guard.select("dish-a:1");
  const first = guard.start();
  assert.equal(guard.matches("dish-a:1", first), true);
  guard.select(""); // unsaved edits
  guard.select("dish-a:1");
  assert.equal(guard.matches("dish-a:1", first), false);
  const next = guard.start();
  guard.select("dish-b:1");
  assert.equal(guard.matches("dish-a:1", next), false);
  const oldRequest = guard.start();
  const newRequest = guard.start();
  assert.equal(guard.matches("dish-b:1", oldRequest), false);
  assert.equal(guard.matches("dish-b:1", newRequest), true);
  guard.invalidate();
  assert.equal(guard.matches("dish-b:1", newRequest), false);
});
