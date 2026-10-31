import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/hospitality-catalogue/route.ts", import.meta.url), "utf8");

test("bulk route contract keeps category optional, trimmed and scoped to explicit canonical IDs", () => {
  assert.match(route, /itemIds: z\.array\(Id\)\.min\(1\)\.max\(50\)/);
  assert.match(route, /expectedVersions: z\.record\(z\.string\(\), Version\)/);
  assert.match(route, /category: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)\.optional\(\)/);
  assert.match(route, /categoryVisibilityConfirmed: z\.boolean\(\)\.optional\(\)/);
  assert.match(route, /const BulkCommand = z\.object\([\s\S]*?\}\)\.strict\(\)/);
  assert.match(route, /body\?\.action === "bulk-update"[\s\S]*?BulkCommand\.parse\(body\)/);
});

test("strict bulk route does not admit an item name or a global/unselected category target", () => {
  const bulkSchema = route.match(/const BulkCommand = z\.object\(([\s\S]*?)\)\.strict\(\);/)?.[1] || "";
  assert.ok(bulkSchema);
  assert.doesNotMatch(bulkSchema, /itemName|allItemIds|unselectedItemIds/);
  assert.match(bulkSchema, /category: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)\.optional\(\)/);
});
