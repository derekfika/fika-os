import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clampPortionDishWidth, portionDishWidthLimit } from "../app/portion-planner";

const planner = readFileSync(new URL("../app/portion-planner.tsx", import.meta.url), "utf8");
const resizeStyles = readFileSync(new URL("../app/portion-planner-resize.css", import.meta.url), "utf8");

test("dish column width is clamped to a useful minimum, viewport-aware maximum and safe default", () => {
  assert.equal(portionDishWidthLimit(1000), 450);
  assert.equal(portionDishWidthLimit(1800), 520);
  assert.equal(portionDishWidthLimit(320), 180);
  assert.equal(portionDishWidthLimit(Number.NaN), 520);
  assert.equal(clampPortionDishWidth(100, 400), 180);
  assert.equal(clampPortionDishWidth(760, 400), 400);
  assert.equal(clampPortionDishWidth(Number.NaN, 400), 280);
  assert.equal(clampPortionDishWidth(300, 120), 180);
});

test("resize handle is keyboard and pointer operable with an adjustable separator value", () => {
  assert.match(planner, /className="portion-column-resize" role="separator" aria-orientation="vertical"/);
  assert.match(planner, /aria-valuemin=\{MIN_PORTION_DISH_WIDTH\} aria-valuemax=\{dishColumnMax\} aria-valuenow=\{dishColumnWidth\}/);
  assert.match(planner, /onPointerDown=\{resizeDishPointerDown\} onPointerMove=\{resizeDishPointerMove\}/);
  assert.match(planner, /onPointerUp=\{event => finishDishResize\(event\.pointerId\)\}/);
  assert.match(planner, /event\.key === "ArrowLeft"[\s\S]*event\.key === "ArrowRight"[\s\S]*event\.key === "Home"[\s\S]*event\.key === "End"/);
});

test("long dish names wrap without truncation and portion input values remain data-backed", () => {
  assert.match(planner, /className="portion-dish-name" title=\{entry\.itemLabel\}>\{entry\.itemLabel\}/);
  assert.match(planner, /value=\{valueFor\(entry, destination\)\}/);
  assert.match(planner, /entries\.reduce\(\(sum, entry\) => sum \+/);
  assert.match(resizeStyles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(resizeStyles, /line-clamp|text-overflow:\s*ellipsis/);
});

test("resize preference is local to the browser, and the table grows only with dish and destination widths", () => {
  assert.match(planner, /fika-menu-portion-dish-width:v1/);
  assert.match(planner, /window\.localStorage\.getItem\(PORTION_DISH_WIDTH_KEY\)/);
  assert.match(planner, /window\.localStorage\.setItem\(PORTION_DISH_WIDTH_KEY/);
  assert.match(planner, /dishColumnWidth \+ destinations\.length \* PORTION_DESTINATION_WIDTH \+ PORTION_TOTAL_WIDTH/);
  assert.match(resizeStyles, /touch-action: none/);
  assert.match(resizeStyles, /:focus-visible[\s\S]*var\(--fika-focus-ring\)/);
});
