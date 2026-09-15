import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU production matrices use governed Drive ownership for each canonical source", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const materializer = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  assert.equal((materializer.match(/\/api\/allergen-matrix\/drive/g) || []).length, 1);
  assert.match(materializer, /HOSPITALITY_BOOKING_BASE_URL/);
  assert.match(materializer, /productionOrderId: order\.canonicalId/);
  assert.match(materializer, /matrixDriveConfiguration\(order\)\.enabled/);
  assert.match(materializer, /if \(!matrixDriveConfiguration\(order\)\.enabled\) throw/);
  assert.match(materializer, /CPU-Master-\$\{serviceDate\}-\$\{releaseToken\}\.pdf/);
  assert.match(materializer, /siteArtifact/);
  assert.match(materializer, /plan\.masterMatrixArtifact/);
  assert.match(materializer, /plan\.siteMatrixArtifacts/);
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /productionPlanEndpoint = "\/api\/production-plan"/);
  assert.match(detail, /action: "save-matrix"/);
  assert.doesNotMatch(source, /siteKey:|oplocFolder:|destinationOwner|siteOwner|ownerCredentials/);
});
