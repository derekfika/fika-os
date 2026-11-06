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

test("bulk-create route delegates every row to the canonical create command and publishes once for touched products", () => {
  assert.match(route, /const CreateItem = z\.object\(\{ action: z\.literal\("create-item"\)/);
  assert.match(route, /const BulkCreateCommand = z\.object\(\{ action: z\.literal\("bulk-create"\), operationId: z\.string\(\)\.min\(8\)\.max\(80\), items: z\.array\(CreateItem\.omit\(\{ action: true \}\)\)\.min\(1\)\.max\(50\) \}\)\.strict\(\)/);
  assert.match(route, /body\?\.action === "bulk-create"[\s\S]*?runBulkCatalogueCreate\(actor,[\s\S]*?republishAfterMutation\(\)/);
  assert.match(route, /restrictToSelectedOplocs/);
});

test("category rename route is strict, bounded, versioned and reloads canonical catalogue plus service layout", () => {
  assert.match(route, /action: z\.literal\("rename-category"\), operationId: z\.string\(\)\.min\(8\)\.max\(80\)/);
  assert.match(route, /expectedItemVersions: z\.record\(z\.string\(\), Version\)\.refine\(value => Object\.keys\(value\)\.length <= 500/);
  assert.match(route, /expectedLayoutVersions: z\.record\(z\.string\(\), z\.number\(\)\.int\(\)\.nonnegative\(\)\)\.refine\(value => Object\.keys\(value\)\.length <= 100/);
  assert.match(route, /reason: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(500\)/);
  assert.match(route, /if \(result\.reload\) return NextResponse\.json\(\{ message: result\.message, package: pkg, payload: await attachServiceLayout\(await loadCataloguePayload\(actor\)\) \}/);
});
