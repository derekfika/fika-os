import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");

test("mobile workflow protects sheets and returns focus", () => {
  assert.match(workflow, /if \(!busy && event\.target === event\.currentTarget\) onClose\(\)/);
  assert.match(workflow, /event\.key === "Escape" && !busy/);
  assert.match(workflow, /returnFocusToStop/);
  assert.match(workflow, /aria-label="Close stop details"/);
  assert.match(workflow, /aria-label="Close report issue"/);
});

test("mobile workflow locks committed writes and exposes progress", () => {
  assert.match(workflow, /if \(pendingAction\) return/);
  assert.match(workflow, /setPendingAction\(action\)/);
  assert.match(workflow, /role="status" aria-live="polite"/);
  assert.match(workflow, /Dispatching…/);
  assert.match(workflow, /Submitting…/);
  assert.match(workflow, /disabled=\{busy\}/);
});

test("mobile controls have names, semantic action classes and touch-safe focus styling", () => {
  assert.match(workflow, /aria-label=\{`Open details for/);
  assert.match(workflow, /aria-label=\{label\}/);
  assert.match(workflow, /className="primary-action"/);
  assert.match(workflow, /className="secondary-action/);
  assert.match(workflow, /className="danger-action/);
  assert.match(styles, /\.driver-app button\s*\{\s*min-height: 44px;/);
  assert.match(styles, /button:focus-visible/);
});

test("active logistics production UI does not use native browser dialogs", () => {
  assert.doesNotMatch(workflow, /window\.(alert|confirm|prompt)\s*\(/);
});
