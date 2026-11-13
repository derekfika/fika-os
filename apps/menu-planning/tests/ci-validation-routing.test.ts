import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts as Record<string, string>;
const workflow = readFileSync(new URL("../../../.github/workflows/validate.yml", import.meta.url), "utf8");

function job(name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `${name} job exists`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z-]*:/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

test("Menu Planning keeps its complete isolated test-file suite", () => {
  assert.equal(scripts.test, "tsx --test tests/*.test.ts");
  assert.doesNotMatch(scripts.test, /(?:--test-isolation|--experimental-test-isolation)=none/);
});

test("Menu Planning tests and exact-source validation remain required when affected", () => {
  const scope = job("scope");
  const application = job("application-tests");
  const validation = job("menu-validation");
  const gate = job("merge-gate");
  assert.match(scope, /menu: \$\{\{ steps\.scope\.outputs\.menu \}\}/);
  assert.match(scope, /menu=\$\{apps\.includes\("menu"\)\}/);
  assert.match(application, /- run: npm ci\n\s+if: matrix\.app != 'hospitality' && matrix\.app != 'menu'/);
  assert.match(application, /- run: npm ci --prefix '\$\{\{ steps\.app\.outputs\.path \}\}'/);
  assert.match(application, /if: matrix\.app == 'menu'\n\s+with:\n\s+node-version: '22'\n\s+cache: npm\n\s+cache-dependency-path: apps\/menu-planning\/package-lock\.json/);
  assert.match(application, /- run: npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' test/);
  assert.match(validation, /if: needs\.scope\.outputs\.menu == 'true'/);
  assert.match(validation, /cache-dependency-path: apps\/menu-planning\/package-lock\.json/);
  assert.doesNotMatch(validation, /^\s+- run: npm ci$/m);
  assert.match(validation, /npm ci --prefix apps\/menu-planning/);
  assert.match(validation, /npm --prefix apps\/menu-planning run typecheck/);
  assert.match(validation, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(validation, /GITHUB_SHA="\$SOURCE_SHA" npm --prefix apps\/menu-planning run build/);
  assert.match(gate, /needs: \[[^\]]*application-tests, menu-validation,/);
  assert.match(gate, /MENU_VALIDATION: \$\{\{ needs\.menu-validation\.result \}\}/);
  assert.match(gate, /case "\$MENU_VALIDATION" in success\|skipped/);
});
