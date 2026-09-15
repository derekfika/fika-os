import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requireCatalogueMutationActor, type MenuActor } from "../lib/auth";
import { catalogueSourceHash } from "../lib/catalogue-source";

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

test("catalogue source certification hashes the transactionally authoritative merged set", () => {
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /transaction\.get\(db\.collection\("fikaMenuPlanningCatalogue"\)\.where\("kind", "==", "dish"\)\)/);
  assert.match(repository, /catalogueSourceHash\(authoritativeItems\)/);
  assert.doesNotMatch(repository, /catalogueSourceHash\(persistedItems\)/);
  const item = (id: string, displayName: string) => ({ canonicalId: id, displayName });
  const initial = [item("dish:a", "A"), item("dish:b", "B")];
  const staleA = [item("dish:a", "A1"), item("dish:b", "B")];
  const staleB = [item("dish:a", "A"), item("dish:b", "B1")];
  const commit = (authoritative: typeof initial, requested: typeof initial, revision: number) => {
    const next = new Map(authoritative.map(value => [value.canonicalId, value]));
    for (const value of requested) next.set(value.canonicalId, value);
    const items = [...next.values()];
    return { sourceRevision: revision + 1, sourceHash: catalogueSourceHash(items as any), items };
  };
  const first = commit(initial, [staleA[0]], 0);
  const second = commit(first.items, [staleB[1]], first.sourceRevision);
  assert.equal(second.sourceRevision, 2);
  assert.equal(second.sourceHash, catalogueSourceHash([staleA[0], staleB[1]] as any));
  assert.deepEqual(second.items, [staleA[0], staleB[1]]);
  const sameRecord = commit(second.items, [item("dish:a", "A2")], second.sourceRevision);
  assert.equal(sameRecord.sourceRevision, 3);
  assert.equal(sameRecord.sourceHash, catalogueSourceHash([item("dish:a", "A2"), staleB[1]] as any));
});
