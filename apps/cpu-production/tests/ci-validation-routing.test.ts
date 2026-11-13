import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("CPU local test command runs each unit and emulator file once", () => {
  assert.match(scripts.test, /^tsx --test --test-concurrency=\d+ tests\/\*\.test\.ts tests\/\*\.emulator\.ts$/);
  assert.match(scripts["test:unit"], /^tsx --test --test-concurrency=\d+ tests\/\*\.test\.ts$/);
  const concurrency = Number(/--test-concurrency=(\d+)/.exec(scripts["test:unit"])?.[1]);
  assert.ok(concurrency > 1 && concurrency <= 4, "unit file concurrency stays bounded");
  assert.equal(scripts["test:emulator"], "tsx --test --test-concurrency=1 tests/production-plan-route-concurrency.emulator.ts");
  assert.deepEqual(readdirSync(new URL(".", import.meta.url)).filter(name => name.endsWith(".emulator.ts")), ["production-plan-route-concurrency.emulator.ts"]);
  assert.doesNotMatch(scripts.test, /(?:--test-isolation|--experimental-test-isolation)=none/);
});

test("CPU unit, shared-contract, emulator, typecheck and exact-source build all gate CI", () => {
  const scope = job("scope");
  const application = job("application-tests");
  const validation = job("cpu-validation");
  const emulator = job("cpu-emulator");
  const gate = job("merge-gate");
  assert.match(scope, /cpu: \$\{\{ steps\.scope\.outputs\.cpu \}\}/);
  assert.match(scope, /cpu=\$\{apps\.includes\("cpu"\)\}/);
  assert.match(application, /if: matrix\.app == 'cpu'\n\s+run: npm --prefix apps\/cpu-production run test:unit/);
  assert.match(application, /Shared contract tests \(apps\/shared\/\*\.test\.ts\)/);
  assert.match(application, /if: matrix\.app == 'cpu'\n\s+run: find apps\/shared/);
  assert.match(application, /Firebase CLI for Ad-Hoc emulator tests\n\s+if: matrix\.app == 'adhoc'/);
  assert.match(validation, /if: needs\.scope\.outputs\.cpu == 'true'/);
  assert.match(validation, /npm --prefix apps\/cpu-production run typecheck/);
  assert.match(validation, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(validation, /GITHUB_SHA="\$SOURCE_SHA" npm --prefix apps\/cpu-production run build/);
  assert.match(emulator, /if: needs\.scope\.outputs\.cpu == 'true'/);
  assert.match(emulator, /actions\/setup-java@/);
  assert.match(emulator, /npm install --global firebase-tools@15\.30\.2/);
  assert.match(emulator, /npm --prefix apps\/cpu-production run test:emulator/);
  assert.match(gate, /needs: \[[^\]]*application-tests, cpu-validation, cpu-emulator,/);
  assert.match(gate, /CPU_VALIDATION: \$\{\{ needs\.cpu-validation\.result \}\}/);
  assert.match(gate, /CPU_EMULATOR: \$\{\{ needs\.cpu-emulator\.result \}\}/);
  assert.match(gate, /case "\$CPU_VALIDATION" in success\|skipped/);
  assert.match(gate, /case "\$CPU_EMULATOR" in success\|skipped/);
});
