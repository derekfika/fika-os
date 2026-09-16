import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU allergen retry action uses semantic tokens defined by its imported token surface", async () => {
  const [layout, tokens, styles] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fika-tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/allergens/page.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /import ["']\.\/fika-tokens\.css["']/);
  for (const token of ["--fika-action-primary", "--fika-action-primary-hover", "--fika-focus-ring", "--fika-surface-subtle", "--fika-border-default", "--fika-text-secondary"]) {
    assert.match(tokens, new RegExp(`${token}:`), `${token} must resolve from CPU's imported token file`);
  }
  assert.match(styles, /\.cpu-allergen-retry\{[^}]*background:var\(--fika-action-primary\)/);
  assert.match(styles, /\.cpu-allergen-retry:hover\{background:var\(--fika-action-primary-hover\)/);
  assert.match(styles, /\.cpu-allergen-retry:focus-visible\{outline:3px solid var\(--fika-focus-ring\)/);
  assert.match(styles, /\.cpu-allergen-retry:disabled\{[^}]*background:var\(--fika-surface-subtle\)/);
});
