import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/rotations/rotations.module.css", import.meta.url), "utf8");
const fonts = readFileSync(new URL("../app/fonts.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../../../shared/fika/tokens.css", import.meta.url), "utf8");

test("Hospitality Rotations uses the loaded shared Gilroy token throughout controls", () => {
  assert.match(tokens, /--fika-font-body:\s*var\(--font-body\)/);
  assert.match(fonts, /font-family:\s*"FIKA Gilroy"/);
  assert.match(css, /\.page\s*\{[^}]*font-family:\s*var\(--fika-font-body\),\s*sans-serif/s);
  assert.match(css, /\.page\s+button,\s*\.page\s+input,\s*\.page\s+select\s*\{\s*font:\s*inherit;/);
  assert.match(css, /\.page\s+button,\s*\.page\s+input,\s*\.page\s+select,\s*\.page\s+textarea,\s*\.page\s+option\s*\{\s*font-family:\s*var\(--fika-font-body\),\s*sans-serif;/);
  assert.doesNotMatch(css, /font-family:\s*Gilroy,\s*Arial/);
});
