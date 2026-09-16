import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("second-signature finalisation commits first and materializes through the durable release path", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const materializer = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  const retryMaterializer = await readFile(new URL("../lib/cpu-retry-materialization.ts", import.meta.url), "utf8");
  assert.match(source, /const candidate = structuredClone\(plan\)/);
  assert.match(source, /Object\.assign\(plan, candidate\)/);
  assert.match(source, /if \(!plan\.currentAllergenRelease\)/);
  assert.match(source, /z\.literal\("save-matrix"\)/);
  assert.match(source, /expectedLineage: ExpectedLineage/);
  assert.match(source, /saveAndAppendCpuChange\(plan, expectedUpdatedAt/);
  assert.match(retryMaterializer, /cpu-release-materialize/);
  assert.doesNotMatch(source, /createMatrixArtifact\(|publishDailySignedOplocBundle\(|allergen-matrix\/drive/);
  assert.match(page, /setFinalizationComplete\(statuses\.length === orderIds\.length && statuses\.every\(status => status\.matrixStatus === "ready"\)\)/);
  assert.doesNotMatch(page, /if \(fullySigned\) void fetch[\s\S]*save-matrix/);
  assert.match(materializer, /const startedResult = await repository\.saveAndAppendCpuChange\(preparedCandidate, stored\.updatedAt/);
  assert.match(materializer, /createCpuReleaseArtifacts\(startedPlan/);
  assert.match(materializer, /await prepared\.publish\(\)/);
  assert.match(materializer, /const finalResult = await repository\.saveAndAppendCpuChange\(ready, preparedPlan\.updatedAt/);
  assert.match(materializer, /releaseToken/);
  assert.match(materializer, /cpuReleaseMaterializationReceiptId/);
  assert.doesNotMatch(materializer, /idempotencyKey: `cpu-release-materialize:\$\{releaseId\}:(started|prepared|final)`/);
});

test("operator retry replays pending or failed OPLOC materialization without plan mutation", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const retryMaterializer = await readFile(new URL("../lib/cpu-retry-materialization.ts", import.meta.url), "utf8");
  assert.match(source, /const releaseNeedsMaterialization = Boolean\(plan\.currentAllergenRelease && \["pending", "current"\]\.includes\(plan\.currentAllergenRelease\.status\) && plan\.currentAllergenRelease\.materializationStatus !== "ready"\)/);
  assert.match(source, /const materializationDelivery = releaseNeedsMaterialization && changedOrder/);
  assert.match(source, /action: z\.literal\("save-matrix"\)/);
  assert.match(source, /if \(command\.action === "save-matrix"\) await replayCpuPropagation\(materializationDelivery\.eventId\)/);
  assert.match(source, /materializationDelivery: materializationResult \|\| null/);
  assert.doesNotMatch(source, /if \(command\.action === "sign-matrix"\) await replayCpuPropagation/);
  assert.match(source, /action: z\.literal\("retry-materialization"\)/);
  assert.match(source, /retryCommittedCpuMaterialization/);
  assert.match(source, /if \(command\.action === "retry-materialization"\)/);
  assert.match(retryMaterializer, /await dependencies\.replay\(delivery\.eventId\)/);
  assert.match(retryMaterializer, /const materializationDelivery = await dependencies\.deliver\(delivery\.eventId\)/);
  assert.doesNotMatch(retryMaterializer, /saveAndAppendCpuChange|persistPlan|updatedAt\s*=/);
});
