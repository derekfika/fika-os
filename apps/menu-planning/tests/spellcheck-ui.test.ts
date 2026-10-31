import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/spellcheck-panel.tsx", import.meta.url), "utf8");

test("spell corrections use the versioned draft-entry update and never the canonical catalogue API", () => {
  assert.match(planner, /dayStatus === "draft" : snapshot\.week\.status === "draft"/);
  assert.match(planner, /expectedWeekVersion: snapshot\.week\.version/);
  assert.match(planner, /patch: \{ itemLabel: corrected \}/);
  assert.doesNotMatch(planner, /replaceDraftSpelling[\s\S]{0,900}fetch\("\/api\/catalogue"/);
});

test("spelling panel requires an explicit confirmation before replacement", () => {
  assert.match(panel, /Replace with \$\{suggestion\}/);
  assert.match(panel, /Replace this word in this draft menu row only\?/);
  assert.match(panel, /Confirm replacement/);
  assert.match(panel, /onReplace\(pending\.item, pending\.finding, pending\.replacement\)/);
});

test("inline correction is accessible by click and preserves Ignore and dictionary actions", () => {
  assert.match(panel, /onMouseEnter=\{\(\) => setOpen\(true\)\}/);
  assert.match(panel, /onFocusCapture=\{\(\) => setOpen\(true\)\}/);
  assert.match(panel, /onClick=\{\(\) => setOpen\(value => !value\)\}/);
  assert.match(panel, /onIgnore\(finding\.word\)/);
  assert.match(panel, /onAddWord\(finding\.word\)/);
  assert.match(panel, /disabled=\{!item\.replaceable\}/);
});
