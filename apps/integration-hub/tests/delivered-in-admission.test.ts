import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("known Delivered-In canonical resolution is a direct document lookup", async () => {
  const domain = await readFile(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  assert.match(domain, /orders\(\)\.doc\(stableDocumentId\(canonicalId\)\)\.get\(\)/);
  assert.doesNotMatch(route, /productionQueue\(undefined\)/);
  assert.match(route, /canonicalId/);
});

test("Delivered-In discovery is explicitly bounded and recovers legacy requiredBy records without a collection scan", async () => {
  const domain = await readFile(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  assert.match(domain, /orders\(\)\.where\("serviceDate", ">=", weekCommencing\)/);
  assert.match(domain, /orders\(\)\.where\("requiredBy", ">=", `\$\{weekCommencing\}T00:00:00Z`\)/);
  assert.doesNotMatch(domain, /orders\(\)\.orderBy\("requiredBy", "asc"\)\.get\(\)/);
  assert.match(route, /serviceDate.*londonBusinessDate/);
  assert.match(domain, /origin === "hospitality_booking" && order\.requiresDelivery === false/);
  assert.match(domain, /!order\.supersededBy && order\.status !== "amended"/);
});

test("Delivered-In admission read diagnostics are opt-in and structural", async () => {
  const domain = await readFile(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  const diagnostics = await readFile(new URL("../lib/delivered-in-read-budget.ts", import.meta.url), "utf8");
  assert.match(domain, /stage: "discovery"/);
  assert.match(domain, /stage: "known_order_lookup"/);
  assert.match(diagnostics, /DELIVERED_IN_READ_BUDGET/);
  assert.doesNotMatch(diagnostics, /db\.collection|\.set\(|\.add\(/);
});
