import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digest } from "./digest";
import { executeCutover, readSnapshot } from "./execute";
import { createFirestoreStore } from "./firestore-store";
import { assertCanWrite } from "./guards";
import { buildPlan } from "./plan";
import { restoreCutover } from "./restore";
import { ConcurrentCatalogueChangeError, MANIFEST_PATH } from "./store";
import { fixedNow, makeWorld } from "./test-fixtures";
import { verifyCutover } from "./verify";

/**
 * Runs the SAME cutover code against the Firestore emulator through the real @google-cloud/firestore adapter.
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, e.g.:
 *   firebase emulators:exec --only firestore --project demo-fika-cutover "npx tsx --test lib/catalogue-cutover/emulator.test.ts"
 * The project must be a demo-* id; the adapter is never pointed at a real project here.
 */
const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = "demo-fika-cutover";

describe("Firestore emulator (real adapter)", { skip: host ? false : "FIRESTORE_EMULATOR_HOST not set" }, () => {
  it("plan -> execute -> verify -> restore drill, with a concurrent-revision abort", async () => {
    assert.ok(host && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host), "emulator host must be local");
    await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
    const world = makeWorld({ project });
    const store = createFirestoreStore(project);
    const seeded = world.store.exportAll();
    const paths = Object.keys(seeded);
    for (let start = 0; start < paths.length; start += 200) await store.writeBatch(paths.slice(start, start + 200).map(path => ({ op: "create" as const, path, data: seeded[path] })));

    const memoryPlan = buildPlan(await readSnapshot(world.store), world.inputs, { batchSize: 4 }).plan;
    const emulatorPlan = buildPlan(await readSnapshot(store), world.inputs, { batchSize: 4 }).plan;
    assert.equal(emulatorPlan.planHash, memoryPlan.planHash, "same pre-state, same plan hash across stores");

    const authorise = (hash: string) => assertCanWrite(project, { execute: true, approvalHash: hash, computedHash: hash }, { FIRESTORE_EMULATOR_HOST: host });
    const opts = { approvalHash: emulatorPlan.planHash, actor: "cutover-tool:emulator", approvedBy: "Derek Buckley", authorise, batchSize: 4, now: fixedNow };

    // A concurrent writer bumps the manifest revision: the guarded transaction aborts and leaves nothing half-applied.
    const manifest = (await store.get(MANIFEST_PATH))!;
    const bumped = { ...manifest, sourceRevision: Number(manifest.sourceRevision) + 1 };
    await store.writeBatch([{ op: "set", path: MANIFEST_PATH, data: bumped }]);
    await assert.rejects(executeCutover(store, world.inputs, opts), /Plan hash|plan hash|ConcurrentCatalogueChange|approval hash/i);
    await store.writeBatch([{ op: "set", path: MANIFEST_PATH, data: manifest }]);

    const result = await executeCutover(store, world.inputs, opts);
    assert.equal(result.status, "completed");
    const report = await verifyCutover(store, { cutoverId: result.cutoverId, inputs: world.inputs, expectActive: world.ids.keep.length, sampleIds: [world.ids.mergeFrom] });
    assert.ok(report.ok, JSON.stringify(report.checks.filter(check => !check.ok)));
    assert.equal(report.resolverStates[world.ids.mergeFrom], `merged->${world.ids.mergeTo}`);
    assert.equal((await executeCutover(store, world.inputs, opts)).status, "already-complete");

    const restored = await restoreCutover(store, { archiveId: result.cutoverId, actor: "cutover-tool:emulator", approvedBy: "Derek Buckley", authorise, batchSize: 4, now: fixedNow });
    assert.equal(restored.status, "restored");
    const after = await readSnapshot(store);
    for (const item of after.docs) assert.equal(digest(item.data), digest(seeded[`fikaMenuPlanningCatalogue/${item.id}`]), item.id);
    assert.equal(after.manifest?.sourceHash, manifest.sourceHash);
    void ConcurrentCatalogueChangeError;
  });
});
