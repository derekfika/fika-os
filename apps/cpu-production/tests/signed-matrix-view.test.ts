import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
const responseBuilder = readFileSync(new URL("../lib/cpu-plan-response.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");

test("CPU signed matrix view is gated by the exact signed allergen review", () => {
  assert.match(route, /download.*html/);
  assert.match(route, /signedAllergenReviewMatchesOrder/);
  assert.match(route, /allergenMatrixHtml/);
  assert.match(responseBuilder, /signedMatrixAvailable/);
  assert.match(responseBuilder, /signedAllergenReviewMatchesOrder\(safe, input\.order/);
  assert.match(route, /revokedReleaseDeliveries/);
  // A signed (or partly signed) matrix is read-only: no local code path clears signatures because of an edit. Signatures are only
  // cleared after the server has completed the canonical reopen.
  assert.doesNotMatch(editor, /markMatrixEdited/);
  const clears = editor.split("setSignatures([])").length - 1;
  assert.equal(clears, 1, "signatures are cleared in exactly one place");
  assert.ok(editor.indexOf("setSignatures([])") > editor.indexOf("const confirmReopen"), "…and only inside the reopen confirmation, after the server result");
});
