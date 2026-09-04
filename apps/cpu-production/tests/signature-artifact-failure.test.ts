import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("second signature is persisted before a final artifact failure is returned", async () => {
  const source = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(source, /allergen-matrix-artifact-failed/);
  assert.match(source, /await persistPlan\(plan, expectedUpdatedAt\);\s*throw error;/);
});
