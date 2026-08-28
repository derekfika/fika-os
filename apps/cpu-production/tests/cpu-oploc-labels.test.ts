import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/cpu-oploc-labels.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
const projection = readFileSync(new URL("../lib/cpu-projection.ts", import.meta.url), "utf8");

test("CPU destination enrichment uses bounded batched OPLOC reads", () => {
  assert.doesNotMatch(helper, /integrationHubCanonical/);
  assert.doesNotMatch(helper, /\/api\/oplocs/);
  assert.match(helper, /\/api\/oploc-labels/);
  assert.match(helper, /hubJson\(/);
});

test("CPU production list, detail and projection paths delegate to bounded enrichment", () => {
  assert.doesNotMatch(route, /integrationHubCanonical/);
  assert.doesNotMatch(projection, /integrationHubCanonical/);
  assert.match(route, /withReadableDestinations\(/);
  assert.match(projection, /withReadableDestinations\(/);
});
