import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/cpu-tablet.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("tablet stylesheet is loaded and every layout rule is scoped to tablet widths", () => {
  assert.match(layout, /import "\.\/cpu-tablet\.css"/);
  // Only the tablet-bar/rail-close defaults may sit outside a media query (they hide the tablet-only controls on desktop).
  const outside = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  const selectors = [...outside.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  for (const selector of selectors) assert.match(selector, /cpu-tablet-bar|cpu-rail-close/, `unscoped rule: ${selector}`);
  assert.match(css, /@media \(max-width: ?1200px\)/);
});

test("sidebar and operations rail are drawers on tablet with menu controls and keyboard dismissal", () => {
  for (const hook of ["cpu-tablet-bar", "cpu-tablet-menu", "cpu-tablet-ops", "cpu-drawer-backdrop", 'id="cpu-sidebar"', 'id="cpu-operations-rail"']) assert.ok(page.includes(hook), hook);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /aria-expanded=\{navOpen\}/);
  assert.match(css, /position: ?sticky/);
});

test("tablet touch targets and no page-level horizontal scroll", () => {
  assert.match(css, /min-height: ?44px/);
  assert.match(css, /\.liana-fullscreen/);
  assert.match(css, /overflow-x: ?(?:hidden|clip|auto)/);
});
