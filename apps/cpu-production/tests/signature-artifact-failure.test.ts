import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("second signature is persisted before a final artifact failure is returned", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(source, /allergen-matrix-artifact-failed/);
  assert.match(source, /await persistPlan\(plan, expectedUpdatedAt\);\s*throw error;/);
  assert.match(source, /if \(!plan\.currentAllergenRelease\)/);
  assert.match(source, /z\.literal\("save-matrix"\)/);
  assert.match(await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8"), /Retry final signed PDF/);
  assert.match(source, /FIKA PDF renderer failure/);
  assert.match(source, /renderPdfToBuffer/);
  assert.match(source, /pdfBase64/);
});
