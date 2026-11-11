import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name: string) => readFile(new URL(`../app/${name}`, import.meta.url), "utf8");

test("targeted Menu Planning dialogs use the shared modal contract", async () => {
  const [week, rolling, primitive, duplicate] = await Promise.all([read("week-planner.tsx"), read("rolling-menu-workspace.tsx"), read("planner-modal.tsx"), read("duplicate-planning-modal.tsx")]);
  assert.match(week, /DuplicatePlanningModal/);
  assert.match(duplicate, /PlannerModal/);
  assert.match(rolling, /PlannerModal/);
  assert.match(primitive, /role="dialog"/);
  assert.match(primitive, /aria-modal="true"/);
  assert.match(primitive, /onCloseRef\.current\(\)/);
  assert.match(primitive, /event\.key !== "Tab"/);
  assert.match(primitive, /modalLockCount/);
  assert.match(primitive, /releasePageScroll\(\)/);
  assert.match(primitive, /focus\(\{ preventScroll: true \}\)/);
  assert.match(week + rolling, /dismissible=\{false\}/);
  assert.match(duplicate, /button-danger/);
  assert.match(duplicate, /Replace and copy as draft/);
  assert.match(duplicate, /needsConfirmation && <label/);
});

test("targeted production files contain no native browser dialogs", async () => {
  const source = `${await read("week-planner.tsx")}\n${await read("rolling-menu-workspace.tsx")}`;
  assert.doesNotMatch(source, /window\.(alert|confirm|prompt)\s*\(/);
});

test("Duplicate Planning uses a viewport-bound large modal with accessible selection and a pinned footer (#254)", async () => {
  const [duplicate, css] = await Promise.all([read("duplicate-planning-modal.tsx"), read("final-tightening.css")]);
  // Structure: scrolling body holds form + preview; footer stays a direct child of the dialog.
  assert.match(duplicate, /className="duplicate-body"[\s\S]*className="duplicate-form"[\s\S]*className="duplicate-preview"[\s\S]*<footer className="form-actions">/);
  assert.match(duplicate, /duplicate-segment--weeks/);
  assert.match(duplicate, /aria-live="polite" aria-label="Duplicate preview"/);
  assert.match(duplicate, /Published days are protected/);
  assert.match(duplicate, /expectedVersions/);
  assert.match(duplicate, /Destination weeks, \$\{destinationOffsets\.length\} selected/);
  assert.match(duplicate, /aria-describedby="duplicate-destinations-help"/);
  assert.match(duplicate, /dismissible=\{!saving\}/);
  // Dialog is bound to the viewport and never scrolls the page; only the body scrolls, never sideways.
  assert.match(css, /\.planner-modal\.duplicate-planning-dialog\s*\{[^}]*width: min\(760px, calc\(100vw - 32px\)\)[^}]*max-height: calc\(100dvh - 32px\)[^}]*overflow: hidden/);
  assert.match(css, /\.duplicate-body\s*\{[^}]*min-height: 0[^}]*overflow-x: hidden[^}]*overflow-y: auto/);
  assert.match(css, /\.duplicate-segment--weeks\s*\{[^}]*max-height: 196px[^}]*overflow-y: auto/);
  assert.match(css, /@media \(min-width: 760px\)\s*\{\s*\.duplicate-body\s*\{[^}]*grid-template-columns/);
  assert.match(css, /@media \(max-width: 560px\)/);
  // Native choices keep a visible semantic-token focus ring and 44px touch targets.
  assert.match(css, /\.duplicate-planning-dialog \.duplicate-segment > label:focus-within/);
  assert.match(css, /outline: 3px solid var\(--fika-focus-ring\)/);
  assert.match(css, /accent-color: var\(--fika-action-primary\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // Light operational surface: no dark background or hard-coded dark islands in the dialog block.
  const block = css.slice(css.indexOf("Duplicate Planning (#254)"));
  assert.doesNotMatch(block, /background:\s*(#0|#1|#2|black|var\(--deep\))/i);
});
