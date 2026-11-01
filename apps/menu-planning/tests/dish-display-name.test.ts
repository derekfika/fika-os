import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dishDisplayName, dishDisplayNameOffset } from "../lib/dish-display-name";

test("display labels remove only the legacy Menu-Item marker", () => {
  const source = "Menu-Item: Rolling: Bean-Sprout-Coriander-Lime-And-Mint-Asian-Raw-Slaw";
  assert.equal(dishDisplayName(source), "Rolling: Bean-Sprout-Coriander-Lime-And-Mint-Asian-Raw-Slaw");
  assert.equal(dishDisplayNameOffset(source), "Menu-Item: ".length);
  assert.equal(dishDisplayName("menu-item:\tExample dish"), "Example dish");
  assert.equal(dishDisplayName("Menu item: Example dish"), "Menu item: Example dish");
  assert.equal(dishDisplayName("Example dish"), "Example dish");
});

test("Week Planner and Dish Library render the label formatter without changing catalogue data", () => {
  const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
  const library = readFileSync(new URL("../app/catalogue-workspace.tsx", import.meta.url), "utf8");
  assert.match(planner, /dishDisplayName\(entry\.itemLabel\)/);
  assert.match(library, /dishDisplayName\(entry\.name\)/);
  assert.match(library, /encodeURIComponent\(selected\.id\)/, "the edit link retains its stable canonical identity");
});
