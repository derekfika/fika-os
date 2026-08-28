import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/cpu-oploc-labels.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
const projection = readFileSync(new URL("../lib/cpu-projection.ts", import.meta.url), "utf8");

test("CPU destination enrichment uses bounded batched OPLOC reads", () => {
  assert.doesNotMatch(helper, /\/api\/oplocs/);
  assert.doesNotMatch(helper, /collection\(["']integrationHubCanonical["']\)\.get\(\)/);
  assert.match(helper, /where\("entityType", "==", "OPLOC"\)/);
  assert.match(helper, /where\("canonicalId", "in", chunk\)/);
  assert.match(helper, /index \+= 30/);
});

test("CPU production list, detail and projection paths delegate to bounded enrichment", () => {
  assert.doesNotMatch(route, /collection\(["']integrationHubCanonical["']\)\.get\(\)/);
  assert.doesNotMatch(projection, /collection\(["']integrationHubCanonical["']\)\.get\(\)/);
  assert.match(route, /withReadableDestinations\(/);
  assert.match(projection, /withReadableDestinations\(/);
});
