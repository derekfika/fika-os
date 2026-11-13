import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageScripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts as Record<string, string>;
const workflow = readFileSync(new URL("../../../.github/workflows/validate.yml", import.meta.url), "utf8");

function job(name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `${name} job exists`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z-]*:/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

test("Logistics unit files stay isolated and the emulator suite stays exclusive", () => {
  const concurrency = Number(/--test-concurrency=(\d+)/.exec(packageScripts.test)?.[1]);
  assert.ok(concurrency > 1 && concurrency <= 4, "bounded file concurrency remains enabled");
  assert.doesNotMatch(packageScripts.test, /(?:--test-isolation|--experimental-test-isolation)=none/);
  assert.match(packageScripts["test:emulator"], /--test-concurrency=1/);
});

test("both Logistics validation lanes are required by the exact-source merge gate", () => {
  const tests = job("application-tests");
  const validation = job("logistics-validation");
  const gate = job("merge-gate");
  assert.match(job("scope"), /logistics: \$\{\{ steps\.scope\.outputs\.logistics \}\}/);
  assert.match(job("scope"), /logistics=\$\{apps\.includes\("logistics"\)\}/);
  assert.match(tests, /npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' test/);
  assert.equal((tests.match(/matrix\.app != 'hub' && matrix\.app != 'logistics'/g) || []).length, 2);
  assert.match(validation, /if: needs\.scope\.outputs\.logistics == 'true'/);
  assert.match(validation, /npm --prefix apps\/logistics run typecheck/);
  assert.match(validation, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(validation, /GITHUB_SHA="\$SOURCE_SHA" npm --prefix apps\/logistics run build/);
  assert.match(gate, /needs: \[[^\]]*application-tests, logistics-validation,/);
  assert.match(gate, /LOGISTICS_VALIDATION: \$\{\{ needs\.logistics-validation\.result \}\}/);
  assert.match(gate, /case "\$LOGISTICS_VALIDATION" in success\|skipped/);
});
