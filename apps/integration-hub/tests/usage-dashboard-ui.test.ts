import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/ui/UsageDashboard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/ui/usage-dashboard.module.css", import.meta.url), "utf8");

test("Usage Observatory mobile layout prioritises health, supports app filtering, and keeps table labels", () => {
  assert.match(source, /healthCards/);
  assert.match(source, /mobileRefresh/);
  assert.match(source, /onSelectApp\("all"\)/);
  assert.match(source, /data-label="Action"/);
  assert.match(source, /data-label="Operation"/);
  assert.match(styles, /position:sticky/);
  assert.match(styles, /\.tableScroll thead\{display:none\}/);
  assert.match(styles, /\.healthCards\{grid-template-columns:repeat\(2,1fr\)/);
});

test("Usage Observatory retains accessible chart focus and mobile tap sizing", () => {
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /focus-visible/);
});
