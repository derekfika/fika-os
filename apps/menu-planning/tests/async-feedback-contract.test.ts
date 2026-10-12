import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portion = readFileSync(new URL("../app/portion-planner.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/final-tightening.css", import.meta.url), "utf8");

test("portion planner Save uses the same spinner as Publish", () => {
  assert.match(portion, /\{saving && <span className="action-spinner" aria-hidden="true" \/>\}\{saving \? "Saving…" : "Save changes"\}/);
  assert.match(portion, /\{publishing && <span className="action-spinner" aria-hidden="true" \/>\}\{publishing \? "Publishing week…"/);
});

test("the action spinner is hidden under reduced motion instead of freezing", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.action-spinner \{ display: none !important; animation: none !important; \}/);
});
