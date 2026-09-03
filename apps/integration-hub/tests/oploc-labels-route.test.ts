import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/oploc-labels/route.ts", import.meta.url), "utf8");

test("OPLOC label contract is authenticated, bounded and persistence-contained", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /requireActor\(request\)/);
  assert.match(route, /assertPermission\(actor, "canonical\.view"\)/);
  assert.match(route, /oplocIds: z\.array/);
  assert.match(route, /\.max\(100\)/);
  assert.match(route, /new Set\(oplocIds\)/);
  assert.match(route, /getOplocReadPackage/);
  assert.match(route, /redirects/);
  assert.doesNotMatch(route, /collection\(/);
});
