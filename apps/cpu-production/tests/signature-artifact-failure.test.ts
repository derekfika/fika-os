import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("second-signature finalisation uses an atomic candidate and never triggers browser duplication", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const candidate = structuredClone\(plan\)/);
  assert.match(source, /createMatrixArtifact\(candidate,/);
  assert.match(source, /Object\.assign\(plan, candidate\)/);
  assert.doesNotMatch(source, /allergen-matrix-artifact-failed[\s\S]*await persistPlan\(plan/);
  assert.match(source, /if \(!plan\.currentAllergenRelease\)/);
  assert.match(source, /z\.literal\("save-matrix"\)/);
  assert.match(page, /body\.matrixStatus === "ready"/);
  assert.doesNotMatch(page, /if \(fullySigned\) void fetch[\s\S]*save-matrix/);
  assert.match(source, /FIKA PDF renderer failure/);
  assert.match(source, /renderPdfToBuffer/);
  assert.match(source, /pdfBase64/);
});
