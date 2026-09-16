import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("second-signature finalisation commits first and materializes through the durable release path", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const materializer = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  assert.match(source, /const candidate = structuredClone\(plan\)/);
  assert.match(source, /Object\.assign\(plan, candidate\)/);
  assert.match(source, /if \(!plan\.currentAllergenRelease\)/);
  assert.match(source, /z\.literal\("save-matrix"\)/);
  assert.match(source, /expectedLineage: ExpectedLineage/);
  assert.match(source, /saveAndAppendCpuChange\(plan, expectedUpdatedAt/);
  assert.match(source, /cpu-release-materialize/);
  assert.doesNotMatch(source, /createMatrixArtifact\(|publishDailySignedOplocBundle\(|allergen-matrix\/drive/);
  assert.match(page, /setFinalizationComplete\(statuses\.length === orderIds\.length && statuses\.every\(status => status\.matrixStatus === "ready"\)\)/);
  assert.doesNotMatch(page, /if \(fullySigned\) void fetch[\s\S]*save-matrix/);
  assert.match(materializer, /saveAndAppendCpuChange\(preparedCandidate, stored\.updatedAt/);
  assert.match(materializer, /await prepared\.publish\(\)/);
  assert.match(materializer, /saveAndAppendCpuChange\(ready, artifactCandidate\.updatedAt/);
  assert.match(materializer, /releaseToken/);
});
