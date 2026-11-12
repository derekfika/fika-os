import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = new URL("../app/", import.meta.url);
const styles = readFileSync(new URL("dish-title-wrap.css", app), "utf8");
const checker = readFileSync(new URL("allergen-checker.tsx", app), "utf8");
const contract = readFileSync(new URL("../../shared/allergen-contract.ts", import.meta.url), "utf8");

function finalRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `expected a CSS rule for ${selector}`);
  return matches.at(-1)![1];
}

test("long and unbroken dish names wrap inside a fixed, bounded allergen column", () => {
  const matched = styles.match(/\.operational-allergen-matrix thead th:first-child,\s*\.operational-allergen-matrix tbody th\s*\{([^}]+)\}/g);
  assert.ok(matched?.length, "dish header and row heading share a bounded rule");
  const declarations = matched.find((rule) => /max-width:\s*300px/.test(rule));
  assert.ok(declarations, "desktop Dish column is capped at 300px");
  assert.match(declarations, /width:\s*300px/);
  assert.match(declarations, /min-width:\s*220px/);
  assert.match(declarations, /max-width:\s*300px/);
  assert.match(declarations, /white-space:\s*normal/);
  assert.match(declarations, /overflow-wrap:\s*anywhere/);
  assert.match(declarations, /word-break:\s*normal/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.operational-allergen-matrix thead th:first-child,[\s\S]*?min-width: 220px/);
});

test("the full allergen matrix remains reachable inside a bounded horizontal scroller", () => {
  const viewport = finalRule(".allergen-panel .table-wrap");
  const table = finalRule(".operational-allergen-matrix");
  assert.match(viewport, /width:\s*100%/);
  assert.match(viewport, /max-width:\s*100%/);
  assert.match(viewport, /overflow-x:\s*auto/);
  assert.match(viewport, /overflow-y:\s*auto/);
  assert.match(viewport, /overscroll-behavior-x:\s*contain/);
  assert.match(table, /width:\s*1780px/);
  assert.match(table, /min-width:\s*100%/);
  assert.match(table, /table-layout:\s*fixed/);

  const canonicalColumns = contract.match(/\["[a-z_]+",\s*"[^"]+"\]/g) ?? [];
  assert.equal(canonicalColumns.length, 15, "No Key and all fourteen named allergens have columns");
  assert.match(styles, /thead th:nth-child\(n \+ 2\):nth-child\(-n \+ 16\)[\s\S]*?width:\s*58px/);
  assert.match(styles, /thead th:nth-child\(19\)[\s\S]*?width:\s*170px/);
  assert.match(checker, /CANONICAL_ALLERGEN_COLUMNS\.map/);
  assert.match(checker, /<th scope="col">Dish<\/th>/);
  assert.match(checker, /<th scope="row">\{entry\.itemLabel\}/);
  assert.match(checker, /<th scope="col">Review<\/th>/);
  assert.match(checker, /No Key Allergens deliberately/);
});

test("dish names and first/last allergen controls are not truncated or removed by layout CSS", () => {
  assert.doesNotMatch(styles, /text-overflow\s*:\s*ellipsis/);
  assert.doesNotMatch(styles, /-webkit-line-clamp\s*:/);
  assert.doesNotMatch(styles, /\.operational-allergen-matrix[^}]*overflow\s*:\s*hidden/);
  assert.match(checker, /CANONICAL_ALLERGEN_COLUMNS\.map\(\(\[key, label\]\)/);
  assert.match(checker, /aria-label=\{`\$\{entry\.itemLabel\}, \$\{label\}:/);
});

test("the production checker remains one original continuous matrix with ordering as its only row transformation", () => {
  const layout = readFileSync(new URL("layout.tsx", app), "utf8");
  assert.match(checker, /const entries = useMemo\(\(\) => \{/);
  assert.match(checker, /orderAllergenCheckerEntries\(snapshot\.entries\.filter/);
  assert.match(checker, /<tbody>\{entries\.map\(entry =>/);
  assert.doesNotMatch(checker, /<details|allergen-category|reviewedCount|progress/);
  assert.doesNotMatch(checker, /groupAllergenCheckerEntries|occurrenceLabels/);
  assert.doesNotMatch(layout, /allergen-checker\.css/);
  assert.doesNotMatch(styles, /\.allergen-category|\.allergen-day-progress/);
  assert.match(checker, /toggleExplicitAllergen\(draft\.allergens, key as CanonicalAllergenKey\)/);
  assert.match(checker, /command\("batch-update-entries"/);
  assert.match(checker, /localStorage\.setItem\(storageKey/);
});
