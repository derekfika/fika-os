import assert from "node:assert/strict";
import test from "node:test";
import { encodeReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { downloadCpuManifestBytes, parseCpuManifestBytes } from "../lib/cpu-package-store";
import { publishCpuProjectionPackage, publishHostedCpuPackage, type CpuPackageHeadTransaction, type CpuPackagePublicationAdapters, type CpuPackagePublicationDiagnostic } from "../lib/cpu-read-package";
import { cpuProjectionContentHash } from "../lib/cpu-projection-repository";

const projection = (date: string, sequence = 4) => ({ serviceDate: date, revision: 1, lastChangeSequence: sequence, orders: [] as Array<{ id: string }>, summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 }, rebuiltAt: "2036-01-01T00:00:00.000Z" });
function packageFor(value = projection("2036-01-07"), version = 1) {
  const sourceHash = cpuProjectionContentHash(value);
  const encoded = encodeReadPackage("snapshots/cpu-production/projection-week", version, { projection: value }, value.orders.length, { sourceVersion: `cpu-change-${value.lastChangeSequence}`, sourceHash, scope: `week:${value.serviceDate}` });
  return { sourceHash, encoded };
}
function harness(options: { failReadAt?: number; failReadAttemptAt?: Record<number, number>; transactionAttempts?: Record<number, number>; readSnapshot?: (transaction: number, attempt: number, actual: unknown) => unknown; failCommitAt?: number[]; afterCommit?: (index: number, state: { head: unknown }) => void } = {}) {
  let head: unknown;
  let transactions = 0;
  let sets = 0;
  const events: CpuPackagePublicationDiagnostic[] = [];
  const adapter: CpuPackagePublicationAdapters = {
    headRef: "fake-head-ref", headPath: "fikaCpuProjectionPackageHeadsV1/test-head",
    log: event => events.push(event),
    async runTransaction<T>(callback: (transaction: CpuPackageHeadTransaction) => Promise<T>) {
      const index = ++transactions;
      let result!: T;
      let staged: unknown;
      const attempts = options.transactionAttempts?.[index] || 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        staged = undefined;
        const transaction: CpuPackageHeadTransaction = {
          async get() {
            if (options.failReadAt === index || options.failReadAttemptAt?.[index] === attempt) throw Object.assign(new Error("head read failed"), { code: 7 });
            const snapshot = options.readSnapshot?.(index, attempt, head) ?? head;
            return { exists: snapshot !== undefined, data: () => snapshot };
          },
          set(_ref, value) { staged = value; sets += 1; },
        };
        result = await callback(transaction);
      }
      if (options.failCommitAt?.includes(index)) throw Object.assign(new Error(`transaction ${index} commit failed`), { code: 7 });
      if (staged !== undefined) head = staged;
      options.afterCommit?.(index, api);
      return result;
    },
  };
  const objects = new Map<string, Uint8Array>();
  let createCount = 0;
  let hasError: unknown;
  let existenceCalls = 0;
  let createError: unknown;
  let readError: unknown;
  let corruptReadback = false;
  const store: ReadPackageStore = {
    async getManifest() { return undefined; },
    async putManifest() {},
    async has(name) { existenceCalls += 1; if (hasError) throw hasError; return objects.has(name); },
    async putImmutable(name, bytes, _hash, onOperation) {
      existenceCalls += 1;
      onOperation?.({ stage: "existence", outcome: "started" });
      if (hasError) { onOperation?.({ stage: "existence", outcome: "failed", error: hasError }); throw hasError; }
      const exists = objects.has(name);
      onOperation?.({ stage: "existence", outcome: exists ? "exists" : "absent" });
      if (exists) return;
      onOperation?.({ stage: "create", outcome: "started" });
      createCount += 1;
      if (createError) { onOperation?.({ stage: "create", outcome: "failed", error: createError }); throw createError; }
      objects.set(name, bytes);
      onOperation?.({ stage: "create", outcome: "completed" });
    },
    async get(name) { if (readError) throw readError; const bytes = objects.get(name); return bytes && corruptReadback ? new Uint8Array([1, 2, 3]) : bytes; },
  };
  const api = {
    adapter, events, objects, store,
    get head() { return head; }, set head(value: unknown) { head = value; },
    get transactions() { return transactions; }, get sets() { return sets; }, get createCount() { return createCount; }, get existenceCalls() { return existenceCalls; },
    set hasError(value: unknown) { hasError = value; }, set createError(value: unknown) { createError = value; }, set readError(value: unknown) { readError = value; }, set corruptReadback(value: boolean) { corruptReadback = value; },
  };
  return api;
}
const stage = (events: CpuPackagePublicationDiagnostic[], name: string, outcome?: CpuPackagePublicationDiagnostic["outcome"]) => events.filter(event => event.stage === name && (!outcome || event.outcome === outcome));

test("manifest 404 means absent; permission and network failures propagate; invalid JSON is explicit", async () => {
  assert.equal(await downloadCpuManifestBytes({ download: async () => { throw Object.assign(new Error("missing"), { code: 404 }); } }), undefined);
  const forbidden = Object.assign(new Error("forbidden"), { code: 403 });
  await assert.rejects(downloadCpuManifestBytes({ download: async () => { throw forbidden; } }), error => error === forbidden);
  const serverFailure = Object.assign(new Error("storage unavailable"), { code: 503 });
  await assert.rejects(downloadCpuManifestBytes({ download: async () => { throw serverFailure; } }), error => error === serverFailure);
  const network = Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
  await assert.rejects(downloadCpuManifestBytes({ download: async () => { throw network; } }), error => error === network);
  assert.throws(() => parseCpuManifestBytes(Buffer.from("{"), "manifests/test.json"), error => (error as { code?: string }).code === "CPU_PACKAGE_MANIFEST_INVALID");
});

test("manifest retrieval failure is attributed and keeps the original SDK error", async () => {
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_RUNTIME_MODE = "production";
  const h = harness();
  const { encoded } = packageFor(projection("2036-02-04"));
  const denied = Object.assign(new Error("permission denied"), { code: 403 });
  const store = { ...h.store, async getManifest() { throw denied; } };
  try {
    await assert.rejects(publishCpuProjectionPackage({ ...projection("2036-02-04"), weekCommencing: "2036-02-04", orders: [] }, { requestId: "req-42" }, { store, adapters: h.adapter }), error => error === denied);
    assert.equal(stage(h.events, "manifest-retrieval", "failed").length, 1);
    assert.equal(stage(h.events, "manifest-retrieval", "failed")[0].errorCode, 403);
    assert.equal(stage(h.events, "manifest-retrieval", "started")[0].requestId, "req-42");
    assert.equal(h.transactions, 0);
  } finally { if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode; }
  assert.equal(encoded.manifest.packageVersion, 1);
});

test("hosted publication reports only committed transactions and verifies raw package bytes", async () => {
  const h = harness();
  const { sourceHash, encoded } = packageFor();
  assert.deepEqual(await publishHostedCpuPackage(h.store, "cpu-production/projection/week:test", encoded, sourceHash, h.adapter, { requestId: "trace-1" }), encoded.manifest);
  assert.equal(stage(h.events, "pending-head-write", "staged").length, 1);
  assert.equal(stage(h.events, "pending-head-commit", "committed").length, 1);
  assert.equal(stage(h.events, "immutable-object-create", "completed").length, 1);
  assert.equal(stage(h.events, "integrity-readback", "verified").length, 1);
  assert.equal(stage(h.events, "current-head-promotion-write", "staged").length, 1);
  assert.equal(stage(h.events, "current-head-promotion-commit", "committed").length, 1);
  assert.equal((h.head as { state: string }).state, "current");
  assert.deepEqual(h.objects.get(encoded.manifest.objectName), encoded.bytes);
  assert.equal(h.existenceCalls, 1, "immutable storage performs exactly one existence check through putImmutable");
  assert.equal(h.createCount, 1);
});

test("retry after a staged pending write attributes the final read failure without a false commit failure", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-12"));
  const h = harness({ transactionAttempts: { 1: 2 }, failReadAttemptAt: { 1: 2 } });
  await assert.rejects(publishHostedCpuPackage(h.store, "test-pending-retry-read-failure", encoded, sourceHash, h.adapter), /head read failed/);
  assert.equal(stage(h.events, "pending-head-write", "staged").length, 1);
  assert.equal(stage(h.events, "package-head-read", "failed").at(-1)?.attempt, 2);
  assert.equal(stage(h.events, "pending-head-commit", "failed").length, 0);
  assert.equal(stage(h.events, "package-head-transaction", "failed").at(-1)?.attempt, 2);
});

test("retry ending in read-only idempotence does not report an abandoned staged pending write as committed", async () => {
  const value = projection("2036-01-13");
  const { sourceHash, encoded } = packageFor(value);
  const currentHead = { state: "current", sourceSequence: value.lastChangeSequence, sourceHash, manifest: encoded.manifest };
  const h = harness({ transactionAttempts: { 1: 2 }, readSnapshot: (transaction, attempt, actual) => transaction === 1 && attempt === 2 ? currentHead : actual });
  h.objects.set(encoded.manifest.objectName, encoded.bytes);
  assert.deepEqual(await publishHostedCpuPackage(h.store, "test-pending-retry-read-only", encoded, sourceHash, h.adapter), encoded.manifest);
  assert.equal(stage(h.events, "pending-head-write", "staged").length, 1);
  assert.equal(stage(h.events, "pending-head-commit", "committed").length, 0);
  assert.equal(h.head, undefined, "only the final read-only transaction attempt is committed");
});

test("promotion retry followed by a read failure is attributed to the final read attempt", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-15"));
  const h = harness({ transactionAttempts: { 2: 2 }, failReadAttemptAt: { 2: 2 } });
  await assert.rejects(publishHostedCpuPackage(h.store, "test-promotion-retry-read-failure", encoded, sourceHash, h.adapter), /head read failed/);
  assert.equal(stage(h.events, "current-head-promotion-write", "staged").length, 1);
  assert.equal(stage(h.events, "current-head-promotion-read", "failed").at(-1)?.attempt, 2);
  assert.equal(stage(h.events, "current-head-promotion-commit", "failed").length, 0);
});

test("cleanup retry followed by a read failure preserves the original publication error", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-16"));
  const original = Object.assign(new Error("immutable create failed"), { code: "OBJECT_CREATE_FAILED" });
  const h = harness({ transactionAttempts: { 2: 2 }, failReadAttemptAt: { 2: 2 } });
  h.createError = original;
  await assert.rejects(publishHostedCpuPackage(h.store, "test-cleanup-retry-read-failure", encoded, sourceHash, h.adapter), error => error === original);
  assert.equal(stage(h.events, "failure-cleanup-write", "staged").length, 1);
  assert.equal(stage(h.events, "failure-cleanup-read", "failed").at(-1)?.attempt, 2);
  assert.equal(stage(h.events, "failure-cleanup-commit", "failed").length, 0);
});

test("package-head read and pending-head commit failures identify their actual stage", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-14"));
  const readFailure = harness({ failReadAt: 1 });
  await assert.rejects(publishHostedCpuPackage(readFailure.store, "test-read", encoded, sourceHash, readFailure.adapter), /head read failed/);
  assert.ok(stage(readFailure.events, "package-head-read", "failed").length);
  assert.equal(readFailure.createCount, 0);

  const commitFailure = harness({ failCommitAt: [1] });
  await assert.rejects(publishHostedCpuPackage(commitFailure.store, "test-pending", encoded, sourceHash, commitFailure.adapter), /transaction 1 commit failed/);
  assert.equal(stage(commitFailure.events, "pending-head-write", "staged").length, 1);
  assert.equal(stage(commitFailure.events, "pending-head-commit", "failed").length, 1);
  assert.equal(stage(commitFailure.events, "pending-head-commit", "committed").length, 0);
  assert.equal(commitFailure.createCount, 0);
});

test("object existence and create failures are attributed and cleanup commits", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-21"));
  const existenceFailure = harness();
  const existsError = Object.assign(new Error("object metadata denied"), { code: 403 });
  existenceFailure.hasError = existsError;
  await assert.rejects(publishHostedCpuPackage(existenceFailure.store, "test-exists", encoded, sourceHash, existenceFailure.adapter), error => error === existsError);
  assert.equal(stage(existenceFailure.events, "immutable-object-existence", "failed").length, 1);
  assert.equal(stage(existenceFailure.events, "failure-cleanup-commit", "committed").length, 1);

  const createFailure = harness();
  const createError = Object.assign(new Error("object create denied"), { code: 403 });
  createFailure.createError = createError;
  await assert.rejects(publishHostedCpuPackage(createFailure.store, "test-create", encoded, sourceHash, createFailure.adapter), error => error === createError);
  assert.equal(stage(createFailure.events, "immutable-object-create", "failed").length, 1);
  assert.equal(stage(createFailure.events, "failure-cleanup-commit", "committed").length, 1);
});

test("integrity read-back failure and current-head promotion failure are stage-attributed", async () => {
  const { sourceHash, encoded } = packageFor(projection("2036-01-28"));
  const integrityFailure = harness();
  integrityFailure.corruptReadback = true;
  await assert.rejects(publishHostedCpuPackage(integrityFailure.store, "test-integrity", encoded, sourceHash, integrityFailure.adapter), /integrity check failed/);
  assert.equal(stage(integrityFailure.events, "integrity-readback", "failed").length, 1);
  assert.equal(stage(integrityFailure.events, "failure-cleanup-commit", "committed").length, 1);

  const promotionFailure = harness({ failCommitAt: [2] });
  await assert.rejects(publishHostedCpuPackage(promotionFailure.store, "test-promotion", encoded, sourceHash, promotionFailure.adapter), /transaction 2 commit failed/);
  assert.equal(stage(promotionFailure.events, "current-head-promotion-write", "staged").length, 1);
  assert.equal(stage(promotionFailure.events, "current-head-promotion-commit", "failed").length, 1);
  assert.equal(stage(promotionFailure.events, "failure-cleanup-commit", "committed").length, 1);
});

test("cleanup failure is logged separately and never replaces the publication error", async () => {
  const h = harness({ failCommitAt: [2] });
  const { sourceHash, encoded } = packageFor(projection("2036-02-02"));
  const original = Object.assign(new Error("primary object failure"), { code: "OBJECT_CREATE_FAILED" });
  h.createError = original;
  await assert.rejects(publishHostedCpuPackage(h.store, "test-cleanup", encoded, sourceHash, h.adapter), error => error === original);
  assert.equal(stage(h.events, "immutable-object-create", "failed").length, 1);
  assert.equal(stage(h.events, "failure-cleanup-commit", "failed").length, 1);
  assert.equal(stage(h.events, "failure-cleanup-commit", "failed")[0].errorCode, 7);
});

test("identical replay is idempotent; same-sequence conflict fails closed", async () => {
  const h = harness();
  const value = projection("2036-02-09");
  const first = packageFor(value);
  await publishHostedCpuPackage(h.store, "test-replay", first.encoded, first.sourceHash, h.adapter);
  const writes = h.sets;
  const objects = h.createCount;
  await publishHostedCpuPackage(h.store, "test-replay", first.encoded, first.sourceHash, h.adapter);
  assert.equal(h.sets, writes);
  assert.equal(h.createCount, objects);
  assert.equal(stage(h.events, "idempotent-integrity-readback", "verified").length, 1);
  const conflict = packageFor({ ...value, orders: [{ id: "different" }] });
  await assert.rejects(publishHostedCpuPackage(h.store, "test-replay", conflict.encoded, conflict.sourceHash, h.adapter), /conflicting content/);
  assert.equal(h.sets, writes);
});

test("a newer current head winning during publication is returned without regression", async () => {
  let newer: ReadPackageManifest | undefined;
  let didRace = false;
  const h = harness({ afterCommit(index, current) {
    if (index === 1 && !didRace && newer) {
      didRace = true;
      current.head = { state: "current", sourceSequence: 9, sourceHash: "newer-source", manifest: newer };
    }
  } });
  const older = packageFor(projection("2036-02-16", 8));
  newer = packageFor(projection("2036-02-16", 9)).encoded.manifest;
  assert.deepEqual(await publishHostedCpuPackage(h.store, "test-race", older.encoded, older.sourceHash, h.adapter), newer);
  assert.equal((h.head as { sourceSequence: number }).sourceSequence, 9);
});
