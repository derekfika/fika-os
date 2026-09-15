import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requireCatalogueMutationActor, type MenuActor } from "../lib/auth";

const actor = (role: MenuActor["role"], synthetic = false): MenuActor => ({ uid: "staff-42", email: "manager@example.test", role, oplocIds: [], allOplocs: true, ...(synthetic ? { synthetic: true } : {}) });

test("catalogue mutation authority is fail-closed for viewers and synthetic admission", () => {
  assert.throws(() => requireCatalogueMutationActor(actor("viewer")), error => (error as { status?: number }).status === 403);
  assert.throws(() => requireCatalogueMutationActor(actor("integration-admin", true)), error => (error as { status?: number }).status === 401);
  assert.equal(requireCatalogueMutationActor(actor("reviewer")).uid, "staff-42");
});

test("catalogue mutation routes pass the resolved actor identity to repository operations", () => {
  const catalogue = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  const candidates = readFileSync(new URL("../app/api/menu/source-candidates/route.ts", import.meta.url), "utf8");
  const importer = readFileSync(new URL("../app/api/rolling-menu/import/route.ts", import.meta.url), "utf8");
  assert.match(catalogue, /requireCatalogueMutationActor\(await resolveMenuActor\(request\)\)/);
  assert.match(catalogue, /createCanonicalMenuItem\(\{ \.\.\.body, displayName: body\.displayName! \}, actor\.uid\)/);
  assert.match(catalogue, /createCanonicalMenuItems\(items, actor\.uid\)/);
  assert.match(catalogue, /mergeSimilarCanonicalItems\(actor\.uid/);
  assert.match(candidates, /promoteSourceCandidate\(item, actor\.uid\)/);
  assert.match(candidates, /setCandidateReview\(item\.canonicalId, "ignored", body\.reason, actor\.uid\)/);
  assert.match(importer, /recordDishSourceAliases\(aliasesById, actor!\.uid\)/);
});
