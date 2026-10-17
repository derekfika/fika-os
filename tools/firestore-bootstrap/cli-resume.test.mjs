import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBootstrapJournal, buildPlan } from "./engine.mjs";
import { runGovernedApply } from "./governed-apply.mjs";

const sv = stringValue => ({ stringValue });
const sourceRecord = (path, label = path) => ({ path, fields: { entityType: sv(label) }, updateTime: "2026-10-17T00:00:00Z" });
const sourceInventory = records => ({ project: "fika-os-dev", records });
const destinationInventory = records => ({ project: "fika-os", records, placeholders: [] });

function fixture() {
  const records = [
    sourceRecord("integrationHubCanonical/item:one"),
    sourceRecord("integrationHubCanonical/item:two"),
    sourceRecord("integrationHubCanonical/item:three"),
  ];
  const source = sourceInventory(records);
  const plan = buildPlan(source, destinationInventory([]));
  const sourceDocuments = new Map(records.map(record => [record.path, record]));
  const targetDocuments = new Map();
  let writes = 0;
  let persistedJournal;
  const makeAdapters = ({ interruptAfterWrites } = {}) => ({
    async readSource(path) {
      if (interruptAfterWrites && writes >= interruptAfterWrites) {
        interruptAfterWrites = undefined;
        throw new Error("Simulated process interruption after journaled prefix.");
      }
      return sourceDocuments.get(path);
    },
    async readDestination(path) { return targetDocuments.get(path); },
    async createDestination(path, fields) {
      assert.equal(targetDocuments.has(path), false, "create-only writes must not overwrite");
      targetDocuments.set(path, { path, fields });
      writes++;
    },
  });
  const run = async ({ journal = persistedJournal, journalPresent = Boolean(persistedJournal), inventory = source, envHash = plan.planHash, adapters = makeAdapters() } = {}) => runGovernedApply({
    savedPlan: plan,
    args: { apply: true, planHash: plan.planHash },
    env: { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: envHash },
    sourceInventory: inventory,
    destinationInventory: destinationInventory([...targetDocuments.values()]),
    journal,
    journalPresent,
    adapters,
    async refreshSourceInventory() { return inventory; },
    async refreshDestinationInventory() { return destinationInventory([...targetDocuments.values()]); },
    async persistJournal(value) { persistedJournal = structuredClone(value); },
  });
  const targetPaths = plan.actions.filter(action => action.action.startsWith("create")).map(action => action.path);
  const writeTarget = path => {
    const sourceDoc = sourceDocuments.get(path);
    targetDocuments.set(path, { path, fields: structuredClone(sourceDoc.fields) });
  };
  return { plan, source, sourceDocuments, targetDocuments, makeAdapters, run, targetPaths, writeTarget, get writes() { return writes; }, get persistedJournal() { return persistedJournal; }, set persistedJournal(value) { persistedJournal = value; } };
}

test("CLI approval/resume path recovers an interrupted prefix and reaches the exact approved target set", async () => {
  const f = fixture();
  await assert.rejects(f.run({ journalPresent: false, journal: undefined, adapters: f.makeAdapters({ interruptAfterWrites: 2 }) }), /Simulated process interruption/);
  assert.equal(f.targetDocuments.size, 2);
  assert.equal(Object.keys(f.persistedJournal.entries).length, 2);

  const resumed = await f.run();
  assert.equal(resumed.planHash, f.plan.planHash);
  assert.equal(f.writes, 3, "resume creates only the remaining approved target");
  assert.equal(resumed.finalDestinationVerification.verifiedDocumentCount, f.targetPaths.length);
  assert.deepEqual([...f.targetDocuments.keys()].sort(), [...f.targetPaths].sort());
});

test("a legal partial destination with the approved plan journal resumes", async () => {
  const f = fixture();
  const firstPath = f.targetPaths[0];
  f.writeTarget(firstPath);
  const journal = createBootstrapJournal(f.plan);
  const action = f.plan.actions.find(item => item.path === firstPath);
  journal.entries[firstPath] = { path: firstPath, sourceHash: action.sourceHash, targetHash: action.targetHash, transforms: action.transforms, status: "created-and-verified" };
  f.persistedJournal = journal;
  const result = await f.run();
  assert.equal(result.finalDestinationVerification.verifiedDocumentCount, f.targetPaths.length);
  assert.equal(f.writes, 2);
});

test("wrong existing body aborts before any further write", async () => {
  const f = fixture();
  const firstPath = f.targetPaths[0];
  f.targetDocuments.set(firstPath, { path: firstPath, fields: { entityType: sv("tampered") } });
  f.persistedJournal = createBootstrapJournal(f.plan);
  await assert.rejects(f.run(), /Unexpected or differing destination document/);
  assert.equal(f.writes, 0);
});

test("extra unplanned and excluded destination documents abort before writes", async t => {
  for (const path of ["unplanned/new-doc", "fikaBookings/excluded-booking"]) {
    await t.test(path, async () => {
      const f = fixture();
      f.targetDocuments.set(path, { path, fields: {} });
      f.persistedJournal = createBootstrapJournal(f.plan);
      await assert.rejects(f.run(), /Unexpected or differing destination document/);
      assert.equal(f.writes, 0);
    });
  }
});

test("journal from another approved plan aborts before writes", async () => {
  const f = fixture();
  f.persistedJournal = { ...createBootstrapJournal(f.plan), planHash: "0".repeat(64) };
  await assert.rejects(f.run(), /Journal identity does not match/);
  assert.equal(f.writes, 0);
});

test("source drift between attempts aborts under the old plan approval", async () => {
  const f = fixture();
  const changedSource = sourceInventory([sourceRecord(f.targetPaths[0], "changed"), ...f.source.records.slice(1)]);
  f.persistedJournal = createBootstrapJournal(f.plan);
  await assert.rejects(f.run({ inventory: changedSource }), /Fresh source state does not match the approved source-state hash/);
  assert.equal(f.writes, 0);
});

test("complete destination with matching journal verifies as a no-op", async () => {
  const f = fixture();
  const journal = createBootstrapJournal(f.plan);
  for (const action of f.plan.actions.filter(item => item.action.startsWith("create"))) {
    f.writeTarget(action.path);
    journal.entries[action.path] = { path: action.path, sourceHash: action.sourceHash, targetHash: action.targetHash, transforms: action.transforms, status: "created-and-verified" };
  }
  f.persistedJournal = journal;
  const result = await f.run();
  assert.equal(f.writes, 0);
  assert.equal(result.finalDestinationVerification.verifiedDocumentCount, f.targetPaths.length);
});

test("partially populated destination without a valid journal fails closed", async () => {
  const f = fixture();
  f.writeTarget(f.targetPaths[0]);
  await assert.rejects(f.run({ journal: undefined, journalPresent: false }), /journal is missing/);
  assert.equal(f.writes, 0);
});

test("the executable CLI delegates apply mode to the tested governed resume path", () => {
  const cli = readFileSync(new URL("./cli.mjs", import.meta.url), "utf8");
  assert.match(cli, /import \{ runGovernedApply \} from "\.\/governed-apply\.mjs"/);
  assert.match(cli, /runGovernedApply\(\{/);
  assert.match(cli, /verifyApprovedPlan\(saved/);
  assert.doesNotMatch(cli, /const plan = buildPlan\(source, destination\);\s*if \(apply\)/);
});
