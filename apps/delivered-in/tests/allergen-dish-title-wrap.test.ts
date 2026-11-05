import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const styles = readFileSync(new URL("../app/delivered-in-polish.css", import.meta.url), "utf8");

test("Delivered-In allergen matrix wraps dish names in a wider first column", () => {
  assert.match(styles, /\.allergen-matrix thead th:first-child,\.allergen-matrix tbody th,[^{}]*\{[^}]*min-width:300px[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /\.ops-allergen-table thead th:first-child,\.ops-allergen-table tbody th:first-child\{[^}]*min-width:300px[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});
