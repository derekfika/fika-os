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

test("Beverage retains isolated test files and the separate emulator script", () => {
  assert.equal(scripts.test, "tsx --test tests/*.test.ts");
  assert.match(scripts["test:emulator"], /firebase emulators:exec --only firestore/);
  assert.doesNotMatch(scripts.test, /(?:--test-isolation|--experimental-test-isolation)=none/);
});

test("Beverage uses its app lockfile without dropping tests, typecheck, build or merge gate", () => {
  const application = job("application-tests");
  const gate = job("merge-gate");
  assert.match(application, /beverage\) path=apps\/beverage-innovation/);
  assert.match(application, /if: matrix\.app == 'beverage'\n\s+with:\n\s+node-version: '22'\n\s+cache: npm\n\s+cache-dependency-path: apps\/beverage-innovation\/package-lock\.json/);
  assert.match(application, /- run: npm ci\n\s+if: matrix\.app != 'hospitality' && matrix\.app != 'menu' && matrix\.app != 'beverage'/);
  assert.match(application, /- run: npm ci --prefix '\$\{\{ steps\.app\.outputs\.path \}\}'/);
  assert.match(application, /- run: npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' test/);
  assert.match(application, /- run: npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' run typecheck/);
  assert.match(application, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(application, /GITHUB_SHA="\$SOURCE_SHA" npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' run build/);
  assert.match(gate, /needs: \[[^\]]*application-tests/);
  assert.match(gate, /case "\$APP_TESTS" in success\|skipped/);
});
