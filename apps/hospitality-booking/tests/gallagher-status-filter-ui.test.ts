import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../lib/rcoa-dashboard/CustomerBookingsDashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/angel-court/gallagher/GallagherDashboard.module.css", import.meta.url), "utf8");

test("customer dashboard exposes accessible checkbox status multi-select with all-status clearing", () => {
  assert.match(component, /<fieldset className=\{`\$\{styles\.field\} \$\{styles\.statusFilters\}`\} aria-describedby=/);
  assert.match(component, /filters\.statuses\.length \? `\$\{filters\.statuses\.length\} selected` : "All statuses"/);
  assert.match(component, /type="checkbox" checked=\{filters\.statuses\.includes\(status\)\}/);
  assert.match(component, /filters\.statuses\.filter\(value => value !== status\)/);
  assert.doesNotMatch(component, /id=\{`\$\{idBase\}-status`\} value=\{filters\.status\}/);
  assert.match(css, /\.statusChoice input \{[^}]*accent-color: var\(--fika-action-primary\)/s);
  assert.match(css, /\.statusChoice \{[^}]*min-height: 44px/s);
  assert.match(css, /\.searchField, \.statusFilters, \.toolbar \.textButton \{ grid-column: 1 \/ -1; \}/);
});
