import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../../../shared/fika/tokens.css", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");

test("site menu and label generation show a spinner, format-specific text and aria-busy instead of a generic 'Working…'", () => {
  assert.match(page, /aria-busy=\{busy \? true : undefined\}/);
  assert.match(page, /<span className="fika-spinner" aria-hidden="true" \/>\{format !== "tablet" \? `Generating \$\{FORMAT_LABELS\[format\]\.toLowerCase\(\)\}…` : "Generating site menu…"\}/);
  assert.doesNotMatch(page, /"Working…"/);
});

test("the shared spinner is available to Delivered-In and hidden under reduced motion", () => {
  assert.match(styles, /@import "\.\.\/\.\.\/\.\.\/shared\/fika\/tokens\.css"/);
  assert.match(tokens, /@media \(prefers-reduced-motion:reduce\)\{\.fika-spinner\{display:none!important;animation:none!important\}\}/);
});
