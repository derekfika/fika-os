import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("rolling-menu read path resolves catalogue data without reconciliation writes", () => {
  const source = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  const getBody = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /syncRollingEntries|attachCanonicalDishIds|saveSnapshot|updateRollingState/);
  assert.match(getBody, /resolvedSnapshot\(snapshot\)/);
});

test("catalogue and rolling-menu GET handlers return structured JSON errors", () => {
  const catalogue = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  const rolling = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(catalogue, /NextResponse\.json\(\{ error: \{ message:/);
  assert.match(rolling, /NextResponse\.json\(\{ error: \{ message:/);
});
