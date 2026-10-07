import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/firebase-admin";
import { encodeReadPackage } from "@fika/server-shared/read-package";
import { publishMonotonicCpuPackage } from "../lib/cpu-read-package";
import { cpuProjectionContentHash } from "../lib/cpu-projection-repository";

test("hosted identical source replay reuses verified immutable bytes without advancing head; conflicting source and corruption fail closed", async () => {
  let head: unknown;
  let headWrites = 0, objectWrites = 0;
  const objects = new Map<string, Uint8Array>();
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousTransaction = db.runTransaction;
  db.runTransaction = (async (action: (transaction: unknown) => Promise<unknown>) => action({ get: async () => ({ exists: Boolean(head), data: () => head }), set: (_ref: unknown, next: unknown) => { head = next; headWrites++; } })) as typeof db.runTransaction;
  process.env.FIKA_RUNTIME_MODE = "staging";
  const store = { putImmutable: async (name: string, bytes: Uint8Array) => { objects.set(name, bytes); objectWrites++; }, get: async (name: string) => objects.get(name), has: async (name: string) => objects.has(name), getManifest: async () => undefined, putManifest: async () => {} };
  const projection = { serviceDate: "2026-10-12", orders: [], revision: 1, lastChangeSequence: 664, rebuiltAt: "first" };
  const sourceHash = cpuProjectionContentHash(projection);
  const encode = (value: typeof projection, version: number) => encodeReadPackage("snapshots/cpu-production/projection-day", version, { projection: value }, 0, { sourceVersion: "cpu-change-664", sourceHash: cpuProjectionContentHash(value) });
  try {
    const first = encode(projection, 1);
    const accepted = await publishMonotonicCpuPackage(store, "owned-test", first, sourceHash);
    const count = headWrites;
    const repeat = encode({ ...projection, revision: 2, rebuiltAt: "later" }, 2);
    assert.notEqual(first.manifest.contentHash, repeat.manifest.contentHash);
    assert.deepEqual(await publishMonotonicCpuPackage(store, "owned-test", repeat, sourceHash), accepted);
    assert.equal(headWrites, count); assert.equal(objectWrites, 1);
    const conflict = { ...projection, serviceDate: "2026-10-13" };
    await assert.rejects(publishMonotonicCpuPackage(store, "owned-test", encode(conflict, 3), cpuProjectionContentHash(conflict)), /conflicting content/);
    objects.set(accepted.objectName, new Uint8Array([1, 2, 3]));
    await assert.rejects(publishMonotonicCpuPackage(store, "owned-test", repeat, sourceHash), /integrity/);
    assert.equal(headWrites, count);
  } finally { db.runTransaction = previousTransaction; if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode; }
});
