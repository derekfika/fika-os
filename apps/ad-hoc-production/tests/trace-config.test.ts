import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Ad-Hoc request boundaries use the shared trace contract", () => {
  const source = readFileSync(new URL("../app/api/requests/route.ts", import.meta.url), "utf8");
  assert.match(source, /withDataTrace/);
  assert.match(source, /dataset:\s*["']ad-hoc-production\/requests/);
  assert.doesNotMatch(source, /console\.(log|info).*body/);
});

test("Ad-Hoc upstream OPLOC reads are classified as network upstream", () => {
  const source = readFileSync(new URL("../app/api/oplocs/route.ts", import.meta.url), "utf8");
  assert.match(source, /source:\s*"NETWORK_UPSTREAM"/);
});
