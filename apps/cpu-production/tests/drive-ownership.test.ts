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
  assert.match(source, /master-\$\{weekCommencing\}\.pdf/);
  assert.match(source, /oploc-\$\{stableFileToken\(oplocId\)\}-\$\{weekCommencing\}\.pdf/);
  assert.match(source, /plan\.masterMatrixArtifact/);
  assert.match(source, /plan\.siteMatrixArtifacts/);
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /productionPlanEndpoint = "\/api\/production-plan"/);
  assert.match(detail, /action: "save-matrix"/);
  assert.doesNotMatch(source, /siteKey:|oplocFolder:|destinationOwner|siteOwner|ownerCredentials/);
});
