import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU production matrices use the CPU Drive owner and never a destination site owner", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.equal((source.match(/\/api\/allergen-matrix\/drive/g) || []).length, 2);
  assert.doesNotMatch(source, /siteKey: siteKey\(order\.destinationLabel\)/);
  assert.doesNotMatch(source, /oplocFolder:/);
});
