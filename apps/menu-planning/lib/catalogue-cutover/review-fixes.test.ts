import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogueSourceHash } from "../catalogue-source";
import { digest } from "./digest";
import { executeCutover, readSnapshot, type ExecuteOptions } from "./execute";
import { assertCanWrite } from "./guards";
import { buildPlan, isDishDoc, recordOf } from "./plan";
import { PostCutoverChangesError, restoreCutover, restoreIntentHash } from "./restore";
import { archivePath, COLLECTIONS, ConcurrentCatalogueChangeError, journalPath, MANIFEST_PATH } from "./store";
import { doc, fixedNow, makeItem, makeWorld, type World } from "./test-fixtures";
import { verifyCutover } from "./verify";

const BATCH = 4;
const memoryAuthorise = (hash: string) => assertCanWrite(undefined, { memory: true, execute: true, computedHash: hash }, {});
const planOf = async (world: World) => buildPlan(await readSnapshot(world.store), world.inputs, { batchSize: BATCH }).plan;
const options = async (world: World): Promise<ExecuteOptions> => ({ approvalHash: (await planOf(world)).planHash, actor: "cutover-tool:test", approvedBy: "Derek Buckley", authorise: memoryAuthorise, batchSize: BATCH, now: fixedNow });
const restoreOpts = (archiveId: string, extra: Record<string, unknown> = {}) => ({ archiveId, actor: "cutover-tool:test", approvedBy: "Derek Buckley", authorise: memoryAuthorise, batchSize: BATCH, now: fixedNow, ...extra });
const idOf = async (opts: ExecuteOptions) => `dish-library-v2-${opts.approvalHash.slice(0, 16)}`;

describe("review fixes", () => {
  it("P2-1: never resumes when the live manifest moved on; journal is marked aborted and points at restore/re-plan", async () => {
    const world = makeWorld();
    const opts = await options(world);
    let seen = 0;
    world.store.beforeCommit = () => { if (++seen === 2) { const manifest = world.store.peek(MANIFEST_PATH)!; world.store.seed(MANIFEST_PATH, { ...manifest, sourceRevision: Number(manifest.sourceRevision) + 1 }); } };
    await assert.rejects(executeCutover(world.store, world.inputs, opts), ConcurrentCatalogueChangeError);
    world.store.beforeCommit = undefined;
    const id = await idOf(opts);
    const catalogueBefore = JSON.stringify(world.store.paths(COLLECTIONS.catalogue).map(path => world.store.peek(path)));
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(executeCutover(world.store, world.inputs, opts), /Aborted => run restore/);
    assert.equal(JSON.stringify(world.store.paths(COLLECTIONS.catalogue).map(path => world.store.peek(path))), catalogueBefore, "no catalogue write while refusing");
    assert.equal(world.store.peek(journalPath(id))!.status, "aborted");
    const restored = await restoreCutover(world.store, restoreOpts(id, { acceptPostCutoverChanges: true }));
    assert.equal(restored.status, "restored", "restore is the supported way out of a partial cutover");
  });

  it("P2-2: restore reports post-cutover edits/new dishes, refuses without the flag, preserves them, and binds approval to the live manifest", async () => {
    const world = makeWorld();
    const result = await executeCutover(world.store, world.inputs, await options(world));
    const edited = world.ids.tags[0];
    const current = recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${edited}`)!);
    world.store.seed(`${COLLECTIONS.catalogue}/${edited}`, doc({ ...current, description: "planner edit after cutover" }));
    const added = makeItem("menu-item:local:added-later", "Added later");
    world.store.seed(`${COLLECTIONS.catalogue}/${added.canonicalId}`, doc(added));

    const hashes: string[] = [];
    const logs: string[] = [];
    const commits = world.store.commits;
    await assert.rejects(restoreCutover(world.store, restoreOpts(result.cutoverId, { log: (message: string) => logs.push(message), authorise: (hash: string) => { hashes.push(hash); return "memory"; } })), (error: unknown) => error instanceof PostCutoverChangesError && error.report.modified[0].id === edited && error.report.modified[0].fields.includes("record.description") && error.report.createdAfterCutover.includes(added.canonicalId));
    assert.ok(logs.some(line => line.includes("Post-cutover changes")), "report printed first");
    assert.equal(world.store.commits, commits, "the refused restore wrote nothing");

    const root = world.store.peek(archivePath(result.cutoverId))!;
    const manifest = world.store.peek(MANIFEST_PATH)!;
    assert.equal(hashes[0], restoreIntentHash(root, { revision: manifest.sourceRevision, hash: manifest.sourceHash }));
    assert.notEqual(hashes[0], restoreIntentHash(root, { revision: Number(manifest.sourceRevision) + 1, hash: manifest.sourceHash }), "a changed live revision invalidates the approval");
    await assert.rejects(restoreCutover(world.store, restoreOpts(result.cutoverId, { acceptPostCutoverChanges: true, authorise: (hash: string) => assertCanWrite(undefined, { memory: true, execute: true, approvalHash: "e".repeat(64), computedHash: hash }, {}) })), /does not equal the computed hash/);
    assert.equal(world.store.commits, commits);

    const done = await restoreCutover(world.store, restoreOpts(result.cutoverId, { acceptPostCutoverChanges: true }));
    assert.equal(done.status, "restored");
    assert.deepEqual(done.postCutover, { modified: 1, created: 1, deleted: 0 });
    assert.equal(digest(world.store.peek(`${COLLECTIONS.catalogue}/${edited}`)), digest(doc(world.v1.get(edited)!)));
    assert.equal(recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${added.canonicalId}`)!).reviewStatus, "archived", "new dish stays readable but archived; never deleted");
    assert.equal(recordOf(world.store.peek(`${archivePath(result.cutoverId)}/postCutoverChanges/${edited}`)!.live as never).description, "planner edit after cutover", "the overwritten edit is preserved");
    assert.equal(world.store.peek(`${archivePath(result.cutoverId)}/postCutoverChanges/${added.canonicalId}`)!.kind, "created");
    const after = world.store.commits;
    assert.equal((await restoreCutover(world.store, restoreOpts(result.cutoverId))).status, "already-restored", "idempotent; no flag needed once handled");
    assert.equal(world.store.commits, after);
  });

  it("P2-3: duplicate active survivor names block the plan unless explicitly allow-listed", async () => {
    const world = makeWorld();
    const second = world.ids.keep[1];
    world.inputs.v2Records.set(second, { ...world.inputs.v2Records.get(second)!, displayName: "Keeper 1" });
    const blockedPlan = await planOf(world);
    assert.equal(blockedPlan.executable, false);
    assert.ok(blockedPlan.blockers.some(blocker => /active name collision "keeper 1"/.test(blocker)), blockedPlan.blockers.join("|"));
    world.inputs.allowedDuplicateNames = ["keeper 1"];
    const allowed = await planOf(world);
    assert.ok(!allowed.blockers.some(blocker => blocker.includes("collision")));
    assert.ok(allowed.warnings.some(warning => warning.includes("explicitly allow-listed")));
    assert.notEqual(allowed.planHash, blockedPlan.planHash, "the allow-list is part of the approved plan");
  });

  it("verify after later catalogue edits: seal-revision equality is not asserted, with a note", async () => {
    const world = makeWorld();
    const result = await executeCutover(world.store, world.inputs, await options(world));
    const id = world.ids.tags[0];
    const current = recordOf(world.store.peek(`${COLLECTIONS.catalogue}/${id}`)!);
    world.store.seed(`${COLLECTIONS.catalogue}/${id}`, doc({ ...current, description: "later edit", revision: current.revision + 1 }));
    const records = (await readSnapshot(world.store)).docs.filter(isDishDoc).map(item => recordOf(item.data));
    const manifest = world.store.peek(MANIFEST_PATH)!;
    world.store.seed(MANIFEST_PATH, { ...manifest, sourceRevision: Number(manifest.sourceRevision) + 1, sourceHash: catalogueSourceHash(records) });
    const report = await verifyCutover(world.store, { cutoverId: result.cutoverId, inputs: world.inputs, expectActive: world.ids.keep.length });
    assert.ok(report.ok, JSON.stringify(report.checks.filter(check => !check.ok)));
    assert.equal(report.notes.length, 1);
    assert.match(report.notes[0], /no longer at the sealed/);
  });

  it("active count never drops below the target while the cutover runs", async () => {
    const world = makeWorld();
    const target = world.ids.keep.length;
    const minimum: number[] = [];
    world.store.beforeCommit = () => { minimum.push(world.store.paths(COLLECTIONS.catalogue).filter(path => { const data = world.store.peek(path)!; return data.kind === "dish" && recordOf(data).reviewStatus !== "archived"; }).length); };
    await executeCutover(world.store, world.inputs, await options(world));
    assert.ok(minimum.length >= 3);
    assert.ok(Math.min(...minimum) >= target, `observed ${Math.min(...minimum)} < ${target}`);
  });

  it("numeric values survive archive + restore with identical digests and bytes", async () => {
    const world = makeWorld();
    const id = world.ids.keep[1];
    const before = world.store.peek(`${COLLECTIONS.catalogue}/${id}`)!;
    assert.equal(recordOf(before).yield, 2);
    assert.equal(recordOf(before).portionSize, 1.5);
    const result = await executeCutover(world.store, world.inputs, await options(world));
    assert.equal(digest(world.store.peek(`${archivePath(result.cutoverId)}/dishes/${id}`)!.data), digest(before));
    await restoreCutover(world.store, restoreOpts(result.cutoverId));
    assert.equal(JSON.stringify(world.store.peek(`${COLLECTIONS.catalogue}/${id}`)), JSON.stringify(before));
  });
});
