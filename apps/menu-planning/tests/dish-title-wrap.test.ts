import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = new URL("../app/", import.meta.url);
const layout = readFileSync(new URL("layout.tsx", app), "utf8");
const styles = readFileSync(new URL("dish-title-wrap.css", app), "utf8");

test("portion planning and Menu allergen dish columns are wider and wrap names", () => {
  assert.match(layout, /import "\.\/dish-title-wrap\.css"/);
  for (const selector of [".portion-matrix", ".operational-allergen-matrix"]) {
    const rule = new RegExp(`${selector} thead th:first-child,[\\s\\S]*?${selector} tbody th\\s*\\{([^}]+)\\}`);
    const match = styles.match(rule);
    assert.ok(match, `${selector} has a dish-column rule`);
    assert.match(match[1], /min-width:\s*300px/);
    assert.match(match[1], /white-space:\s*normal/);
    assert.match(match[1], /overflow-wrap:\s*anywhere/);
  }
  assert.match(styles, /@media \(max-width:\s*600px\)[\s\S]*?\.portion-matrix[\s\S]*?min-width:\s*220px/);
});
