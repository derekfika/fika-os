import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readAppFile = (name: string) => readFile(new URL(`../app/${name}`, import.meta.url), "utf8");

test("Duplicate Planning keeps a reviewable, accessible layout within a standard large dialog", async () => {
  const [modal, css, primitive] = await Promise.all([
    readAppFile("duplicate-planning-modal.tsx"),
    readAppFile("final-tightening.css"),
    readAppFile("planner-modal.tsx"),
  ]);

  assert.match(modal, /className="duplicate-body"[\s\S]*className="duplicate-form"[\s\S]*className="duplicate-preview"[\s\S]*<footer className="form-actions">/);
  assert.match(modal, /Destination weeks, \$\{destinationOffsets\.length\} selected/);
  assert.match(modal, /id="duplicate-destinations-help"/);
  assert.match(modal, /Published days are protected/);
  assert.match(modal, /expectedVersions/);
  assert.match(modal, /dismissible=\{!saving\}/);

  assert.match(css, /\.planner-modal\.duplicate-planning-dialog\s*\{[^}]*width: min\(760px, calc\(100vw - 32px\)\)[^}]*max-height: calc\(100dvh - 32px\)[^}]*overflow: hidden/);
  assert.match(css, /\.duplicate-body\s*\{[^}]*min-height: 0[^}]*overflow-x: hidden[^}]*overflow-y: auto/);
  assert.match(css, /\.duplicate-segment--weeks\s*\{[^}]*max-height: 196px[^}]*overflow-y: auto/);
  assert.match(css, /\.duplicate-planning-dialog \.duplicate-segment > label\s*,[\s\S]*min-height: 44px/);
  assert.match(css, /\.duplicate-planning-dialog \.duplicate-segment > label:focus-within[\s\S]*outline: 3px solid var\(--fika-focus-ring\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(primitive, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(primitive, /openerRef\.current\?\.focus/);
  assert.match(primitive, /event\.key === "Escape"/);
  assert.match(primitive, /event\.key !== "Tab"/);
});
