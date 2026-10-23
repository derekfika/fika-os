import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = new URL("../app/", import.meta.url);
const styles = readFileSync(new URL("visual-system.css", app), "utf8");
const shellStyles = readFileSync(new URL("shell.css", app), "utf8");
const planner = readFileSync(new URL("week-planner.tsx", app), "utf8");

test("Week Planner exposes a synchronized horizontal scrollbar above the weekday grid", () => {
  assert.match(planner, /aria-label="Scroll weekdays horizontally"/);
  assert.match(planner, /scrollbar\.addEventListener\("scroll", syncFromTop/);
  assert.match(planner, /viewport\.addEventListener\("scroll", syncFromMatrix/);
  assert.match(planner, /else if \(event\.key === "End"\) next = max/);
  assert.match(planner, /scrollbar\.scrollLeft = viewport\.scrollLeft =/);
  assert.match(planner, /aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"/);
  assert.match(styles, /\.week-matrix-scrollbar\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.week-matrix-viewport\s*\{[^}]*overflow:\s*auto/s);
  assert.match(styles, /\.week-matrix-corner\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/s);
  assert.match(styles, /\.week-matrix-row\s*>\s*strong\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/s);
});

test("Menu Planning uses one coherent stacked sidebar at split-screen widths", () => {
  assert.doesNotMatch(shellStyles, /@media\s*\(max-width:\s*800px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)\s*\{[^}]*\.menu-shell\s*\{\s*display:\s*block/s);
  assert.match(styles, /\.menu-sidebar-nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.menu-sidebar-link[^}]*white-space:\s*nowrap/s);
});
