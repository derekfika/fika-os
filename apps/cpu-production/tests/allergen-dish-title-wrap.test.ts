import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ui = new URL("../app/ui/", import.meta.url);
const reviewStyles = readFileSync(new URL("allergen-review.css", ui), "utf8");
const hospitalityStyles = readFileSync(new URL("hospitality-allergen-detail.css", ui), "utf8");

test("CPU allergen review dish column wraps inside a wider sticky column", () => {
  assert.match(reviewStyles, /\.cpu-allergen-table thead th:first-child,[\s\S]*?\.cpu-allergen-table tbody th\s*\{[^}]*min-width:300px[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});

test("Hospitality allergen checker widens and wraps its dish-name column", () => {
  assert.match(hospitalityStyles, /\.allergen-checker col\.allergen-col--name\{width:300px\}/);
  assert.match(hospitalityStyles, /\.allergen-checker thead th:first-child,\.allergen-checker tbody th\{[^}]*min-width:300px[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});
