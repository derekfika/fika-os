import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = new URL("../app/", import.meta.url);
const styles = readFileSync(new URL("allergen-checker.css", app), "utf8");
const checker = readFileSync(new URL("allergen-checker.tsx", app), "utf8");
const contract = readFileSync(new URL("../../shared/allergen-contract.ts", import.meta.url), "utf8");

test("allergen categories collapse independently while retaining a scrollable, frozen-header matrix", () => {
  assert.match(checker, /groups\.map\(\(group, groupIndex\)/);
  assert.match(checker, /<details className="allergen-category"/);
  assert.match(checker, /<summary>/);
  assert.match(styles, /\.allergen-category\s*\{/);
  assert.match(styles, /\.allergen-table-wrap[^}]*overflow:\s*auto/);
  assert.match(styles, /\.operational-allergen-matrix thead th\s*\{[^}]*position:\s*sticky;\s*top:\s*0/s);
  assert.match(styles, /\.operational-allergen-matrix thead th:first-child, \.operational-allergen-matrix tbody th\s*\{[^}]*position:\s*sticky;\s*left:\s*0/s);
  assert.match(styles, /max-height:\s*64vh/);
});

test("canonical allergen controls have readable, accessible states and a keyboard-native disclosure", () => {
  const canonicalColumns = contract.match(/\["[a-z_]+",\s*"[^"]+"\]/g) ?? [];
  assert.equal(canonicalColumns.length, 15, "No Key and all fourteen named allergens have columns");
  for (const status of ["Contains", "May contain", "Clear", "Not recorded"]) assert.match(checker, new RegExp(`"${status}"`));
  assert.match(checker, /<details className="allergen-category"/);
  assert.match(checker, /id=\{`allergen-row-\$\{entry\.id\}`\}/);
  assert.match(checker, /aria-describedby=\{`allergen-row-\$\{entry\.id\}`\}/);
  assert.match(checker, /aria-label=\{status\}/);
  assert.match(checker, /role="status" aria-label=\{`\$\{reviewedCount\} of \$\{entries\.length\} dishes reviewed`\}/);
  assert.match(checker, /Not recorded is never treated as clear/);
  assert.match(checker, /CPU approval and sign-off remain separate/);
  assert.match(checker, /command\("batch-update-entries"/);
});

test("sorting and grouping keep drafts and allergen declarations keyed to original entry IDs", () => {
  assert.match(checker, /const groups = useMemo\(\(\) => groupAllergenCheckerEntries\(entries\)/);
  assert.match(checker, /key=\{entry\.id\}/);
  assert.match(checker, /draftFor\(entry\.id, entry\)/);
  assert.match(checker, /Object\.entries\(drafts\)\.map\(\(\[entryId, draft\]\)/);
  assert.match(checker, /groupAllergenCheckerEntries, occurrenceLabels/);
});
