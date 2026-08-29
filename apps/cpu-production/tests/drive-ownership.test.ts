import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU production matrices use governed Drive ownership for each canonical source", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.equal((source.match(/\/api\/allergen-matrix\/drive/g) || []).length, 1);
  assert.match(source, /HOSPITALITY_BOOKING_BASE_URL/);
  assert.match(source, /productionOrderId: orderId/);
  assert.match(source, /matrixDriveConfiguration\(order\)\.enabled/);
  assert.match(source, /if \(!matrixDriveConfiguration\(order\)\.enabled\) return undefined;[\s\S]*fetch\(/);
  const detail = await readFile(new URL("../app/ui/LianaOrderDetail.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(detail, /fetch\("\/api\/production-plan"[\s\S]*save-matrix/);
  assert.doesNotMatch(source, /siteKey:|oplocFolder:|destinationOwner|siteOwner|ownerCredentials/);
});
