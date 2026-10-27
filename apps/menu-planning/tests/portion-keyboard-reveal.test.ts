import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { horizontalScrollDelta } from "../app/portion-scroll";

const planner = readFileSync(new URL("../app/portion-planner.tsx", import.meta.url), "utf8");
const plannerStyles = readFileSync(new URL("../app/planner-stage2.css", import.meta.url), "utf8");

test("a focused destination hidden on the left scrolls left to the visible edge", () => {
  assert.equal(horizontalScrollDelta({ left: 100, right: 180 }, { left: 210, right: 900 }), -110);
});

test("a focused destination hidden under the sticky TOTAL column scrolls right until it clears TOTAL", () => {
  assert.equal(horizontalScrollDelta({ left: 800, right: 880 }, { left: 210, right: 760 }), 120);
});

test("a fully visible destination does not move the matrix", () => {
  assert.equal(horizontalScrollDelta({ left: 300, right: 380 }, { left: 210, right: 760 }), 0);
});

test("a destination wider than the visible area aligns to its left edge rather than oscillating", () => {
  assert.equal(horizontalScrollDelta({ left: 150, right: 900 }, { left: 210, right: 760 }), -60);
});

test("ArrowLeft/ArrowRight/ArrowUp/ArrowDown bindings are unchanged and the handler reveals the focused input", () => {
  assert.match(planner, /const deltas: Record<string, \[number, number\]> = \{ ArrowUp: \[-1, 0\], ArrowDown: \[1, 0\], ArrowLeft: \[0, -1\], ArrowRight: \[0, 1\] \};/);
  assert.match(planner, /target\.focus\(\);\s*revealPortionInput\(target\);\s*target\.select\(\);/);
});

test("the TOTAL column stays sticky, so the reveal compensates for it rather than removing it", () => {
  assert.match(plannerStyles, /.portion-matrix thead th:last-child,.portion-matrix tbody td:last-child{position:sticky;right:0/);
});

test("on phone widths the dish column is no longer sticky, and the reveal only subtracts columns that really are sticky", () => {
  const finalTightening = readFileSync(new URL("../app/final-tightening.css", import.meta.url), "utf8");
  const scroll = readFileSync(new URL("../app/portion-scroll.ts", import.meta.url), "utf8");
  assert.match(finalTightening, /@media \(max-width: 600px\) \{\s*\.portion-matrix thead th:first-child,\s*\.portion-matrix tbody th \{\s*position: static;/);
  assert.match(scroll, /getComputedStyle\(cell\)\.position === "sticky"/);
});
