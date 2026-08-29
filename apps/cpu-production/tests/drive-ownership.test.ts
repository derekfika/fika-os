import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU production matrices use the CPU Drive integration without destination-owner credentials", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.equal((source.match(/\/api\/allergen-matrix\/drive/g) || []).length, 2);
  assert.match(source, /HOSPITALITY_BOOKING_BASE_URL/);
  assert.match(source, /siteKey: siteKey\(order\.destinationLabel\)/);
  assert.match(source, /oplocFolder:/);
  assert.doesNotMatch(source, /destinationOwner|siteOwner|ownerCredentials/);
});
