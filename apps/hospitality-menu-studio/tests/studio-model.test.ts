import assert from "node:assert/strict";
import test from "node:test";
import {
  assortmentTotal,
  localDraftKey,
  moveDish,
  retainedDraftMatchesRequest,
  retainedTimestamp,
  retainedDraftText,
  formatRetainedTime,
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

test("retained timestamps belong only to the exact payload; legacy copies remain readable", () => {
  const raw = JSON.stringify({ id: "old", version: 2 });
  const metadata = JSON.stringify({
    value: raw,
    at: "2026-11-20T12:00:00.000Z",
  });
  assert.equal(retainedTimestamp(raw, metadata), "2026-11-20T12:00:00.000Z");
  assert.equal(retainedTimestamp(raw, null), null);
  assert.equal(retainedTimestamp(raw + " ", metadata), null);
  assert.equal(retainedTimestamp(raw, "broken"), null);
  assert.equal(
    retainedTimestamp(raw, JSON.stringify({ value: raw, at: "invalid" })),
    null,
  );
});

test("recovery text is readable and retention time uses London", () => {
  const dish = {
    id: "private-id",
    version: 2,
    name: "Soup",
    category: "other" as const,
    temperature: "hot" as const,
    customerDescription: "Tomato",
    kitchenDescription: "Warm gently",
    assortment: null,
    updatedAt: "",
  };
  const text = retainedDraftText(dish, []);
  assert.match(text, /Dish: Soup/);
  assert.match(text, /Kitchen description: Warm gently/);
  assert.doesNotMatch(text, /private-id|customerDescription/);
  assert.match(formatRetainedTime("2026-07-01T12:00:00Z"), /13:00/);
  const menu = {
    id: "menu-id",
    version: 1,
    name: "Lunch",
    kind: "seasonal" as const,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    anchorMonday: "",
    updatedAt: "",
    sections: [
      {
        id: "section-id",
        name: "Main",
        catalogueItemId: "",
        mode: "static" as const,
        staticDishIds: [dish.id],
        weeks: [],
      },
    ],
  };
  assert.match(retainedDraftText(menu, [dish]), /Dishes: Soup/);
  assert.doesNotMatch(retainedDraftText(menu, [dish]), /private-id|section-id/);
});
