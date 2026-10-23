import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Hub CI keeps unit tests isolated and runs Firestore coverage in the emulator", () => {
  const workflow = readFileSync("../../.github/workflows/validate.yml", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(workflow, /npm --prefix '\$\{\{ steps\.app\.outputs\.path \}\}' test/);
  assert.doesNotMatch(workflow, /if: matrix\.app != 'hub'/);
  assert.match(workflow, /firebase emulators:exec --only firestore --project demo-fika-os[^\n]+cd apps\/integration-hub && npm run test:emulator/);
  assert.match(workflow, /FIRESTORE_EMULATOR_HOST: 127\.0\.0\.1:8292/);
  assert.match(workflow, /Resolve pinned platform specs gitlink[\s\S]*?git ls-tree HEAD fika-platform-specs/);
  assert.match(workflow, /repository: derekfika\/fika-platform-specs[\s\S]*?ref: \$\{\{ steps\.platform-specs\.outputs\.sha \}\}[\s\S]*?path: fika-platform-specs/);
  assert.match(packageJson.scripts.test, /--test-concurrency=1/);
  assert.match(packageJson.scripts["test:emulator"], /--test-name-pattern=emulator:/);
  assert.match(packageJson.scripts["test:emulator"], /verify-test-firestore-emulator\.mjs/);
  assert.match(packageJson.scripts["test:emulator"], /booking-cutoffs\.emulator\.test\.ts tests\/booking-email-firestore\.test\.ts tests\/fulfilment-projection\.test\.ts tests\/logistics-event-identity\.test\.ts tests\/menu-order-delivery-window\.test\.ts tests\/ordered-quantity-backfill\.test\.ts tests\/production-domain\.test\.ts tests\/production-fulfilment-reconciliation\.test\.ts/);
});
