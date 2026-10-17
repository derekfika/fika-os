import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrap = readFileSync(new URL("../scripts/bootstrap-production-read-packages.ts", import.meta.url), "utf8");

test("production package bootstrap is explicit-production and read-only unless publish is requested", () => {
  assert.match(bootstrap, /EXPECTED_PROJECT = "fika-os"/);
  assert.match(bootstrap, /EXPECTED_BUCKET = "fika-os-prod-read-packages-europe-west4"/);
  assert.match(bootstrap, /project !== EXPECTED_PROJECT \|\| bucketName !== EXPECTED_BUCKET/);
  assert.match(bootstrap, /FIRESTORE_EMULATOR_HOST \|\| process\.env\.FIREBASE_AUTH_EMULATOR_HOST/);
  assert.match(bootstrap, /const publish = process\.argv\.includes\("--publish"\)/);
  assert.match(bootstrap, /const verify = process\.argv\.includes\("--verify"\)/);
  assert.match(bootstrap, /if \(publish\) \{/);
  assert.doesNotMatch(bootstrap, /\.collection\([^\n]+\)\.(?:set|create|update|delete)\(/);
});

test("only the four approved Hub datasets are built in the required order", () => {
  const datasets = [...bootstrap.matchAll(/"(integration-hub\/(?:oplocs|service-arrangements|service-definitions|authmod-references))"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(datasets)].slice(0, 4), [
    "integration-hub/oplocs",
    "integration-hub/service-arrangements",
    "integration-hub/service-definitions",
    "integration-hub/authmod-references",
  ]);
  assert.match(bootstrap, /authmodPayload\.applications\?\.length !== 7/);
  assert.match(bootstrap, /authmodPayload\.oplocs\?\.length !== 19/);
  assert.match(bootstrap, /authmodPayload\.legends\?\.length !== 97/);
  assert.match(bootstrap, /recordCount !== 123/);
  assert.match(bootstrap, /authmod-references:0:0:0/);
  assert.match(bootstrap, /publishReadPackage\(cloudStore, item\.dataset/);
  assert.match(bootstrap, /Verification failed: .*contains staging references/);
});

