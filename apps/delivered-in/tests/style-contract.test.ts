import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Delivered-In operational UI exposes shared-token visible focus", async () => {
  const styles = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(styles, /@import ["']\.\.\/\.\.\/\.\.\/shared\/fika\/tokens\.css/);
  assert.match(styles, /:where\(button,a,select,input,textarea\):focus-visible/);
  assert.match(styles, /var\(--fika-focus-ring\)/);
});
