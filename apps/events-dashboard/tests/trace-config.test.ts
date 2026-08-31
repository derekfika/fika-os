import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Events Dashboard is an active runtime with shared trace boundaries", () => {
  const source = readFileSync(new URL("../app/api/events/route.ts", import.meta.url), "utf8");
  assert.match(source, /app:\"events-dashboard\"/);
  assert.match(source, /dataset:\"events-dashboard\/events\"/);
  assert.match(source, /source:\"UNKNOWN\"/);
});

test("Events upstream Hub reads are not attributed as local Firestore", () => {
  const source = readFileSync(new URL("../app/api/hub-operating-read-contract/route.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\(/);
  assert.doesNotMatch(source, /source:\s*["']FIRESTORE/);
});
