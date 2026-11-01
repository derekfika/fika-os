import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogueSourceHash } from "../catalogue-source";
import { digest } from "./digest";
import { CutoverIntegrityError, executeCutover, readSnapshot, snapshotFromArchive, type ExecuteOptions } from "./execute";
import { assertCanWrite } from "./guards";
import { buildPlan, isDishDoc, recordOf } from "./plan";
import { restoreCutover, RESTORE_VOLATILE_MANIFEST_FIELDS, restoreIntentHash } from "./restore";
import { archivePath, COLLECTIONS, ConcurrentCatalogueChangeError, journalPath, MANIFEST_PATH } from "./store";
import { fixedNow, makeItem, makeWorld, doc, PRE_REVISION, type World } from "./test-fixtures";
import { verifyCutover } from "./verify";

const BATCH = 4;
const memoryAuthorise = (hash: string) => assertCanWrite(undefined, { memory: true, execute: true, computedHash: hash }, {});
const planOf = async (world: World, batchSize = BATCH) => buildPlan(await readSnapshot(world.store), world.inputs, { batchSize }).plan;
const options = async (world: World, overrides: Partial<ExecuteOptions> = {}): Promise<ExecuteOptions> => ({ approvalHash: (await planOf(world)).planHash, actor: "cutover-tool:test", approvedBy: "Derek Buckley", authorise: memoryAuthorise, batchSize: BATCH, now: fixedNow, ...overrides });
const catalogueDocs = (world: World) => Object.fromEntries(world.store.paths(COLLECTIONS.catalogue).map(path => [path, world.store.peek(path)]));
const verify = (world: World, cutoverId: string) => verifyCutover(world.store, { cutoverId, inputs: world.inputs, expectActive: world.ids.keep.length, sampleIds: [world.ids.mergeFrom, ...world.ids.tests, ...world.ids.archived.slice(1)] });

describe("plan (dry run)", () => {
  it("is read-only, deterministic and reports the exact replacement", async () => {
    const world = makeWorld();
    const before = JSON.stringify(world.store.exportAll());
    const first = await planOf(world);
    const second = await planOf(world);
    assert.equal(JSON.stringify(world.store.exportAll()), before);
    assert.equal(world.store.commits, 0);
    assert.equal(first.planHash, second.planHash);
    assert.deepEqual(first.blockers, []);
    assert.equal(first.executable, true);
    assert.equal(first.preState.revision, PRE_REVISION);
    assert.equal(first.preState.dishDocs, 12 + 3 + 2 + 2 + 4);
    assert.equal(first.preState.active, 12 + 3 + 2 + 2);
    assert.equal(first.preState.archived, 4);
    assert.equal(first.preState.otherKindDocs, 1);
    assert.equal(first.archive.docCount, first.preState.dishDocs, "ALL V1 docs incl. already archived are archived");
    assert.equal(first.target.active, world.ids.keep.length);
    assert.equal(first.target.archived, 2 + 1 + 4);
    assert.equal(first.target.keepUpdated, world.ids.tags.length);
    assert.equal(first.target.newlyArchived, 3);
    assert.deepEqual(first.mappedButAbsentFromStore, ["menu-item:staging:only"]);
    assert.equal(first.references.totalIds, 6);
    assert.equal(first.references.merged, 1);
    assert.equal(first.references.unresolved.length, 0);
    assert.ok(first.rollingNine.every(item => item.state === "active"));
    assert.match(first.planHash, /^[a-f0-9]{64}$/);
  });

  it("only merges produce successors; archived ids with no verified target stay unresolved, never guessed", async () => {
    const world = makeWorld();
    const plan = await planOf(world);
    assert.deepEqual(plan.successors.map(({ fromId, toId }) => ({ fromId, toId })), [{ fromId: world.ids.mergeFrom, toId: world.ids.mergeTo }]);
    assert.deepEqual(plan.unresolvedArchived.sort(), [...world.ids.tests, ...world.ids.archived].sort());
    assert.ok(plan.warnings.some(warning => warning.includes("UNRESOLVED")));
  });

  it("plan hash changes when the live pre-state changes", async () => {
    const world = makeWorld();
    const before = (await planOf(world)).planHash;
    const record = recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${world.ids.keep[0]}`)!);
    world.store.seed(`${COLLECTIONS.catalogue}/${record.canonicalId}`, doc({ ...record, description: "edited by someone" }));
    const after = await planOf(world);
    assert.notEqual(after.planHash, before);
    assert.ok(after.blockers.some(blocker => blocker.includes("does not match the documents read")), "manifest/doc disagreement is a blocker");
  });

  const blocked = (name: string, mutate: (world: World) => void, expected: RegExp) => it(`blocks: ${name}`, async () => {
    const world = makeWorld();
    mutate(world);
    const plan = await planOf(world);
    assert.equal(plan.executable, false);
    assert.ok(plan.blockers.some(blocker => expected.test(blocker)), plan.blockers.join(" | "));
  });
  blocked("a V1 document without a mapping decision", world => { world.inputs.mappings = world.inputs.mappings.filter(entry => entry.oldId !== world.ids.tests[0]); }, /no mapping decision/);
  blocked("a V2 record that changes name/category/allergens", world => { const id = world.ids.keep[1]; world.inputs.v2Records.set(id, { ...world.inputs.v2Records.get(id)!, displayName: "Renamed", allergenEvidence: [] }); }, /outside tags\/subtype: allergenEvidence, displayName/);
  blocked("a referenced id that would be archived without a verified successor", world => { world.inputs.references = [{ label: "w", sha256: "0".repeat(64), ids: [world.ids.tests[0]] }]; }, /archived without a verified successor/);
  blocked("a referenced id that is absent from the store", world => { world.inputs.references = [{ label: "w", sha256: "0".repeat(64), ids: ["menu-item:nowhere"] }]; }, /not found in the store/);
  blocked("a merge into a non-survivor (chain/inactive target)", world => { world.inputs.mappings = world.inputs.mappings.map(entry => entry.oldId === world.ids.mergeFrom ? { ...entry, toId: world.ids.tests[0] } : entry); }, /not an active survivor/);
  blocked("a name-based hint masquerading as a successor", world => { world.inputs.mappings = world.inputs.mappings.map(entry => entry.oldId === world.ids.archived[1] ? { ...entry, toId: world.ids.keep[0] } : entry); }, /without verifiedTarget/);
  blocked("a keep of an already archived document", world => { world.inputs.mappings = world.inputs.mappings.map(entry => entry.oldId === world.ids.archived[1] ? { ...entry, action: "keep" as const } : entry); world.inputs.survivorIds.push(world.ids.archived[1]); }, /archived; reactivation/);
  blocked("a rolling id that is not kept", world => { world.inputs.mappings = world.inputs.mappings.map(entry => entry.oldId === world.ids.rolling[0] ? { ...entry, action: "archive" as const } : entry); world.inputs.survivorIds = world.inputs.survivorIds.filter(id => id !== world.ids.rolling[0]); }, /rolling id .* would not be active/);
  blocked("no reference sets", world => { world.inputs.references = []; }, /no reference sets/);
  blocked("a missing manifest", world => { world.store.seed(MANIFEST_PATH, { sourceHash: "x" }); }, /manifest has no integer sourceRevision|does not match/);
});

describe("execute", () => {
  it("happy path: archive first, activate V2 in guarded batches, readback, journal; nothing hard-deleted", async () => {
    const world = makeWorld();
    const pre = catalogueDocs(world);
    const plan = await planOf(world);
    const logs: string[] = [];
    const result = await executeCutover(world.store, world.inputs, await options(world, { log: message => logs.push(message) }));
    assert.equal(result.status, "completed");
    assert.equal(result.active, world.ids.keep.length);
    assert.equal(result.archived, plan.preState.dishDocs - world.ids.keep.length);
    assert.equal(result.revisionAfter, PRE_REVISION + plan.target.batches + 1);
    assert.ok(logs.findIndex(line => line.includes("Archive")) < logs.findIndex(line => line.includes("Batch 1/")), "archive precedes any catalogue write");

    // Every V1 dish document exists in the archive, byte-for-byte (raw digest), and in the live catalogue.
    for (const [path, data] of Object.entries(pre)) {
      if (!isDishDoc({ id: path, data: data! })) continue;
      const id = path.slice(path.lastIndexOf("/") + 1);
      const archived = world.store.peek(`${archivePath(result.cutoverId)}/dishes/${id}`)!;
      assert.equal(digest(archived.data), digest(data), `raw archive of ${id}`);
      assert.ok(world.store.peek(path), `${id} was not deleted`);
    }
    assert.deepEqual(world.store.peek(`${COLLECTIONS.catalogue}/${world.ids.sandwich}`), pre[`${COLLECTIONS.catalogue}/${world.ids.sandwich}`], "non-dish documents untouched");
    // Archived/merged/test dishes are archived; survivors are active and carry V2 tags.
    for (const id of [...world.ids.tests, world.ids.mergeFrom, ...world.ids.archived]) assert.equal(recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${id}`)!).reviewStatus, "archived", id);
    for (const id of world.ids.keep) assert.notEqual(recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${id}`)!).reviewStatus, "archived", id);
    for (const id of world.ids.tags) assert.deepEqual(recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${id}`)!).tagIds, ["dish-tag:type:vegetable-side"]);
    // Untouched survivors are byte-identical (no gratuitous writes).
    const untouched = world.ids.keep.find(id => !world.ids.tags.includes(id))!;
    assert.deepEqual(world.store.peek(`${COLLECTIONS.catalogue}/${untouched}`), pre[`${COLLECTIONS.catalogue}/${untouched}`]);
    // Audit lines are appended, never rewritten.
    const archivedRecord = recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${world.ids.tests[0]}`)!);
    assert.equal(archivedRecord.audit.at(-1)?.action, "dish-library-v2-cutover:archived");
    assert.deepEqual(archivedRecord.audit.slice(0, -1), world.v1.get(world.ids.tests[0])!.audit);

    const manifest = world.store.peek(MANIFEST_PATH)!;
    assert.equal(manifest.sourceRevision, result.revisionAfter);
    assert.equal(manifest.sourceHash, catalogueSourceHash((await readSnapshot(world.store)).docs.filter(isDishDoc).map(item => recordOf(item.data))));
    assert.equal((manifest.cutover as { status: string }).status, "complete");
    assert.equal((manifest.packageState as { status: string }).status, "pending", "app rebuilds the read package from the new source identity");
    assert.deepEqual(manifest.extraFieldToPreserve, { nested: [1, 2, 3] });
    const journal = world.store.peek(journalPath(result.cutoverId))!;
    assert.equal(journal.status, "complete");
    const root = world.store.peek(archivePath(result.cutoverId))!;
    assert.equal(root.status, "sealed");
    assert.equal((root.preCutoverManifest as { revision: number }).revision, PRE_REVISION);
    assert.equal((root.counts as { total: number }).total, plan.preState.dishDocs);
    assert.equal(root.approvedBy, "Derek Buckley");

    const report = await verify(world, result.cutoverId);
    assert.ok(report.ok, JSON.stringify(report.checks.filter(check => !check.ok)));
    assert.equal(report.counts.active, world.ids.keep.length);
    for (const id of world.ids.rolling) assert.equal(report.resolverStates[id], "active");
    assert.equal(report.resolverStates[world.ids.mergeFrom], `merged->${world.ids.mergeTo}`);
    assert.equal(report.resolverStates[world.ids.archived[1]], "archived");
    assert.equal(report.resolverStates[world.ids.tests[0]], "archived");
  });

  it("is idempotent: replay writes nothing", async () => {
    const world = makeWorld();
    const opts = await options(world);
    const first = await executeCutover(world.store, world.inputs, opts);
    const snapshot = JSON.stringify(world.store.exportAll());
    const commits = world.store.commits;
    const second = await executeCutover(world.store, world.inputs, opts);
    assert.equal(second.status, "already-complete");
    assert.equal(second.cutoverId, first.cutoverId);
    assert.equal(world.store.commits, commits);
    assert.equal(JSON.stringify(world.store.exportAll()), snapshot);
  });

  it("aborts and leaves a resumable journal when the manifest revision changes before the first batch", async () => {
    const world = makeWorld();
    const opts = await options(world);
    const original = world.store.peek(MANIFEST_PATH)!;
    let injected = false;
    world.store.beforeCommit = () => { if (!injected) { injected = true; world.store.seed(MANIFEST_PATH, { ...original, sourceRevision: PRE_REVISION + 1, catalogueVersion: PRE_REVISION + 1 }); } };
    await assert.rejects(executeCutover(world.store, world.inputs, opts), ConcurrentCatalogueChangeError);
    world.store.beforeCommit = undefined;
    const journal = world.store.peek(journalPath(await planCutoverId(world, opts)))!;
    assert.equal(journal.status, "aborted");
    assert.match(String(journal.abortReason), /revision/);
    const root = world.store.peek(archivePath(String(journal.cutoverId)))!;
    assert.equal(root.status, "sealed", "the archive survives an aborted activation");
    // No catalogue document was touched.
    const docs = (await readSnapshot(world.store)).docs.filter(isDishDoc);
    for (const item of docs) assert.equal(digest(item.data), digest(doc(world.v1.get(item.id)!)), item.id);
  });

  it("aborts mid-way on a concurrent catalogue write, then resumes once the catalogue matches again", async () => {
    const world = makeWorld();
    const opts = await options(world);
    let batchesSeen = 0;
    const saved: { manifest?: Record<string, unknown> } = {};
    world.store.beforeCommit = async () => { /* count only transactions */ batchesSeen++; if (batchesSeen === 2) { saved.manifest = world.store.peek(MANIFEST_PATH)!; world.store.seed(MANIFEST_PATH, { ...saved.manifest, sourceRevision: Number(saved.manifest.sourceRevision) + 1 }); } };
    await assert.rejects(executeCutover(world.store, world.inputs, opts), ConcurrentCatalogueChangeError);
    world.store.beforeCommit = undefined;
    const aborted = world.store.peek(journalPath(await planCutoverId(world, opts)))!;
    assert.equal(aborted.status, "aborted");
    assert.equal((aborted.progress as { batchesDone: number }).batchesDone, 1, "batch 1 committed, batch 2 refused");
    // The foreign change is reverted (operator decision); the same approval resumes from batch 2.
    world.store.seed(MANIFEST_PATH, saved.manifest!);
    const resumed = await executeCutover(world.store, world.inputs, opts);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.resumedFrom, 1);
    assert.ok((await verify(world, resumed.cutoverId)).ok);
  });

  it("an interrupted run resumes to exactly the state of an uninterrupted run", async () => {
    const clean = makeWorld();
    const cleanResult = await executeCutover(clean.store, clean.inputs, await options(clean));

    const world = makeWorld();
    const opts = await options(world);
    world.store.crashAfterCommits = 7; // journal, 2 archive writes, root, then crash inside the activation batches
    await assert.rejects(executeCutover(world.store, world.inputs, opts), /simulated crash/);
    const interrupted = world.store.peek(journalPath(cleanResult.cutoverId))!;
    assert.notEqual(interrupted.status, "complete");
    world.store.crashAfterCommits = undefined;
    const resumed = await executeCutover(world.store, world.inputs, opts);
    assert.equal(resumed.status, "completed");
    assert.ok(resumed.resumedFrom >= 1);
    const normalise = (store: World["store"]) => { const all = store.exportAll(); delete all[journalPath(cleanResult.cutoverId)]; return JSON.stringify(all); };
    assert.equal(normalise(world.store), normalise(clean.store), "catalogue, manifest and archive are identical to an uninterrupted run");
  });

  it("crash before the archive root is written resumes without duplicating or altering archive children", async () => {
    const world = makeWorld();
    const opts = await options(world);
    world.store.crashAfterCommits = 3; // journal, archive dishes, archive successors; crash before the root
    await assert.rejects(executeCutover(world.store, world.inputs, opts), /simulated crash/);
    world.store.crashAfterCommits = undefined;
    assert.equal(world.store.peek(archivePath(await planCutoverId(world, opts))), undefined);
    const resumed = await executeCutover(world.store, world.inputs, opts);
    assert.equal(resumed.status, "completed");
    assert.ok((await verify(world, resumed.cutoverId)).ok);
  });

  it("refuses to write anything when a guard fails (production flags, hash, approver)", async () => {
    const world = makeWorld();
    const opts = await options(world);
    const planHash = opts.approvalHash;
    const env = { FIKA_CUTOVER_ALLOW_REAL_FIRESTORE: "1" };
    const cases: Array<[string, Parameters<typeof assertCanWrite>[1]]> = [
      ["no --execute", { allowProduction: true, approvalHash: planHash, approvedBy: "Derek", computedHash: planHash }],
      ["no --allow-production", { execute: true, approvalHash: planHash, approvedBy: "Derek", computedHash: planHash }],
      ["no approval hash", { execute: true, allowProduction: true, approvedBy: "Derek", computedHash: planHash }],
      ["no approver", { execute: true, allowProduction: true, approvalHash: planHash, computedHash: planHash }],
      ["wrong hash", { execute: true, allowProduction: true, approvalHash: "f".repeat(64), approvedBy: "Derek", computedHash: planHash }],
    ];
    for (const [label, flags] of cases) {
      const store = makeWorld().store;
      await assert.rejects(executeCutover(store, makeWorld().inputs, { ...opts, authorise: () => assertCanWrite("fika-os", flags, env) }), /Refused/, label);
      assert.equal(store.commits, 0, `${label}: nothing written`);
      assert.equal(store.paths(COLLECTIONS.archives).length, 0);
      assert.equal(store.paths(COLLECTIONS.journals).length, 0);
    }
    const noEnv = makeWorld().store;
    await assert.rejects(executeCutover(noEnv, makeWorld().inputs, { ...opts, authorise: () => assertCanWrite("fika-os", { execute: true, allowProduction: true, approvalHash: planHash, approvedBy: "Derek", computedHash: planHash }, {}) }), /FIKA_CUTOVER_ALLOW_REAL_FIRESTORE/);
    assert.equal(noEnv.commits, 0);
  });

  it("refuses an approval hash that does not match the reviewed plan, and a blocked plan", async () => {
    const world = makeWorld();
    const opts = await options(world);
    await assert.rejects(executeCutover(world.store, world.inputs, { ...opts, approvalHash: "a".repeat(64), authorise: () => "memory" }), CutoverIntegrityError);
    assert.equal(world.store.commits, 0);
    const blockedWorld = makeWorld();
    blockedWorld.inputs.references = [{ label: "w", sha256: "0".repeat(64), ids: [blockedWorld.ids.tests[0]] }];
    const blockedHash = (await planOf(blockedWorld)).planHash;
    await assert.rejects(executeCutover(blockedWorld.store, blockedWorld.inputs, { ...(await options(blockedWorld)), approvalHash: blockedHash }), /Plan is blocked/);
    assert.equal(blockedWorld.store.commits, 0);
  });

  it("a document edited after the archive aborts the batch instead of overwriting it", async () => {
    const world = makeWorld();
    const opts = await options(world);
    const target = world.ids.tags[0];
    let edited = false;
    world.store.beforeCommit = () => { if (!edited) { edited = true; const current = recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${target}`)!); world.store.seed(`${COLLECTIONS.catalogue}/${target}`, doc({ ...current, description: "concurrent edit" })); } };
    await assert.rejects(executeCutover(world.store, world.inputs, opts), ConcurrentCatalogueChangeError);
    world.store.beforeCommit = undefined;
    assert.equal(recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${target}`)!).description, "concurrent edit");
  });
});

async function planCutoverId(world: World, opts: ExecuteOptions) {
  void world;
  const { cutoverIdFor } = await import("./plan");
  return cutoverIdFor(opts.approvalHash);
}

describe("restore (rollback)", () => {
  const volatile = new Set<string>(RESTORE_VOLATILE_MANIFEST_FIELDS);
  const stable = (manifest: Record<string, unknown>) => Object.fromEntries(Object.entries(manifest).filter(([key]) => !volatile.has(key)));
  const restoreOptions = (cutoverId: string) => ({ archiveId: cutoverId, actor: "cutover-tool:test", approvedBy: "Derek Buckley", authorise: memoryAuthorise, batchSize: BATCH, now: fixedNow });

  it("restore drill reproduces V1 byte-for-byte documents and manifest content, idempotently", async () => {
    const world = makeWorld();
    const preDocs = JSON.stringify(catalogueDocs(world));
    const preManifest = world.store.peek(MANIFEST_PATH)!;
    const result = await executeCutover(world.store, world.inputs, await options(world));
    assert.notEqual(JSON.stringify(catalogueDocs(world)), preDocs);

    const restored = await restoreCutover(world.store, restoreOptions(result.cutoverId));
    assert.equal(restored.status, "restored");
    assert.equal(JSON.stringify(catalogueDocs(world)), preDocs, "all documents identical to V1");
    for (const [path, data] of Object.entries(JSON.parse(preDocs))) assert.equal(digest(world.store.peek(path)), digest(data), path);
    const manifest = world.store.peek(MANIFEST_PATH)!;
    assert.deepEqual(stable(manifest), stable(preManifest));
    assert.equal(manifest.sourceHash, preManifest.sourceHash);
    assert.ok(Number(manifest.sourceRevision) > result.revisionAfter, "manifest revision stays monotonic");
    assert.equal(world.store.peek(journalPath(result.cutoverId))!.status, "restored");
    assert.equal(world.store.peek(archivePath(result.cutoverId))!.status, "sealed", "archive remains");

    const commits = world.store.commits;
    const again = await restoreCutover(world.store, restoreOptions(result.cutoverId));
    assert.equal(again.status, "already-restored");
    assert.equal(world.store.commits, commits);
    await assert.rejects(executeCutover(world.store, world.inputs, await options(world, { approvalHash: result.planHash })), /rolled back/);
  });

  it("restores from a partially applied cutover (aborted midway) and from a crash during restore", async () => {
    const world = makeWorld();
    const preDocs = JSON.stringify(catalogueDocs(world));
    const opts = await options(world);
    world.store.crashAfterCommits = 6;
    await assert.rejects(executeCutover(world.store, world.inputs, opts), /simulated crash/);
    world.store.crashAfterCommits = undefined;
    assert.notEqual(JSON.stringify(catalogueDocs(world)), preDocs);
    const cutoverId = (await planCutoverId(world, opts));
    world.store.crashAfterCommits = world.store.commits + 3; // journal + one restore batch + crash
    await assert.rejects(restoreCutover(world.store, restoreOptions(cutoverId)), /simulated crash/);
    world.store.crashAfterCommits = undefined;
    const done = await restoreCutover(world.store, restoreOptions(cutoverId));
    assert.equal(done.status, "restored");
    assert.equal(JSON.stringify(catalogueDocs(world)), preDocs);
  });

  it("refuses when the archive fails its digests, when extra live dishes exist, or when guards fail", async () => {
    const world = makeWorld();
    const result = await executeCutover(world.store, world.inputs, await options(world));
    await assert.rejects(restoreCutover(world.store, { ...restoreOptions(result.cutoverId), authorise: hash => assertCanWrite("fika-os", { execute: true, computedHash: hash }, {}) }), /Refused/);

    const extra = makeItem("menu-item:local:added-later", "Added later");
    world.store.seed(`${COLLECTIONS.catalogue}/${extra.canonicalId}`, doc(extra));
    await assert.rejects(restoreCutover(world.store, restoreOptions(result.cutoverId)), /not in the archive/);

    const tampered = makeWorld();
    const tamperedResult = await executeCutover(tampered.store, tampered.inputs, await options(tampered));
    const path = `${archivePath(tamperedResult.cutoverId)}/dishes/${tampered.ids.keep[0]}`;
    const wrapper = tampered.store.peek(path)!;
    tampered.store.seed(path, { ...wrapper, archivedAt: "1999-01-01" });
    await assert.rejects(restoreCutover(tampered.store, restoreOptions(tamperedResult.cutoverId)), CutoverIntegrityError);
    assert.equal(restoreIntentHash(tampered.store.peek(archivePath(tamperedResult.cutoverId))!).length, 64);
  });

  it("a concurrent manifest change aborts the restore", async () => {
    const world = makeWorld();
    const result = await executeCutover(world.store, world.inputs, await options(world));
    let injected = false;
    world.store.beforeCommit = () => { if (!injected) { injected = true; const manifest = world.store.peek(MANIFEST_PATH)!; world.store.seed(MANIFEST_PATH, { ...manifest, sourceRevision: Number(manifest.sourceRevision) + 1 }); } };
    await assert.rejects(restoreCutover(world.store, restoreOptions(result.cutoverId)), ConcurrentCatalogueChangeError);
  });

  it("snapshotFromArchive rebuilds the exact pre-cutover snapshot", async () => {
    const world = makeWorld();
    const before = await readSnapshot(world.store);
    const result = await executeCutover(world.store, world.inputs, await options(world));
    const { snapshot } = await snapshotFromArchive(world.store, result.cutoverId);
    assert.equal(digest(snapshot.manifest), digest(before.manifest));
    assert.equal(digest(Object.fromEntries(snapshot.docs.map(item => [item.id, item.data]))), digest(Object.fromEntries(before.docs.filter(isDishDoc).map(item => [item.id, item.data]))));
  });
});
