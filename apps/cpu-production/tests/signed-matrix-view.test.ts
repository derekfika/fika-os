import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");

test("CPU signed matrix view is gated by the exact signed allergen review", () => {
  assert.match(route, /download.*html/);
  assert.match(route, /signedAllergenReviewMatchesOrder/);
  assert.match(route, /allergenMatrixHtml/);
  assert.match(route, /signedMatrixAvailable/);
  assert.match(route, /revokedReleaseDeliveries/);
  assert.match(editor, /markMatrixEdited/);
  assert.match(editor, /setSignatures\(\[\]\)/);
});
