import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentReference, ReadOptions, Transaction } from "firebase-admin/firestore";
import { encodeReadPackage, sha256 } from "@fika/server-shared/read-package";
import { readBeverageOplocInventory } from "../lib/beverage-oploc-inventory";
import { canonicalDocumentId } from "../lib/canonical-oplocs";
import { OPLOC_DATASET, type OplocReadPackage } from "../lib/oploc-read-package";

const manifestName = "manifests/integration-hub/oplocs.json";
const headPath = "integrationHubCacheManifests/oplocs";
const first = "oploc:fixture-first";
const second = "oploc:fixture-second";

function fixture(value: OplocReadPackage = {
  oplocs: [second, first].map(canonicalId => ({ canonicalId, label: "Fictional site" })),
  redirects: { "oploc:fixture-old": first },
}) {
  const encoded = encodeReadPackage(OPLOC_DATASET, 3, value, value.oplocs.length + Object.keys(value.redirects ?? {}).length, {
    contractVersion: "integration-hub.oplocs.v2", sourceVersion: "canonical-oplocs:42",
  });
  const { manifest } = encoded;
  const reads: Array<[string, number?]> = [];
  const canonicalIds = new Map(value.oplocs.map(({ canonicalId }) => [`integrationHubCanonical/${canonicalDocumentId(canonicalId)}`, canonicalId]));
  let head = 42;
  let archived: string | undefined;
  let manifestBytes: Uint8Array | undefined;
  let payload: Uint8Array = encoded.bytes;
  const transaction = {
    async get(ref: DocumentReference) {
      reads.push([ref.path]);
      assert.equal(ref.path, headPath);
      return { exists: true, data: () => ({ version: head }) };
    },
    async getAll(...args: Array<DocumentReference | ReadOptions>) {
      assert.deepEqual(args.pop(), { fieldMask: ["canonicalId", "entityType", "lifecycleStatus", "publicationStatus", "record.lifecycleState"] });
      const refs = args as DocumentReference[];
      assert.ok(refs.length <= 100);
      return refs.map(ref => {
        reads.push([ref.path]);
        const canonicalId = canonicalIds.get(ref.path);
        assert.ok(canonicalId);
        return { data: () => ({ canonicalId, entityType: "OPLOC", lifecycleStatus: archived === canonicalId ? "archived" : "published" }) };
      });
    },
  } as Transaction;
  const run = () => readBeverageOplocInventory({
    firestore: { async runTransaction(read, options) {
      assert.deepEqual(options, { readOnly: true });
      return read(transaction);
    } },
    async readObject(name, maxBytes) {
      reads.push([name, maxBytes]);
      if (name === manifestName) return manifestBytes ?? Buffer.from(JSON.stringify(manifest));
      assert.equal(name, encoded.manifest.objectName);
      return payload;
    },
  });
  return {
    run, reads, manifest, setHead: (next: number) => { head = next; }, archive: (id: string) => { archived = id; },
    setManifestBytes: (bytes: Uint8Array) => { manifestBytes = bytes; }, setPayload: (bytes: Uint8Array) => { payload = bytes; },
  };
}

test("operator inventory reads only the current head, pinned objects and exact canonical IDs in a read-only snapshot", async () => {
  const { run, reads, manifest } = fixture();
  assert.deepEqual(await run(), {
    sourceVersion: "canonical-oplocs:42", packageVersion: 3, contentHash: manifest.contentHash,
    inventoryHash: sha256(JSON.stringify([first, second])), count: 2, ids: [first, second],
  });
  assert.deepEqual(reads, [
    [headPath], [manifestName, 64 * 1024], [manifest.objectName, manifest.compressedSize],
    [`integrationHubCanonical/${canonicalDocumentId(first)}`], [`integrationHubCanonical/${canonicalDocumentId(second)}`],
  ]);
});

test("missing, stale, redirected, corrupt and oversized OPLOC evidence cannot open recovery or produce IDs", async () => {
  const missingHead = fixture();
  missingHead.setHead(0);
  await assert.rejects(missingHead.run, /canonical OPLOC head/);
  assert.deepEqual(missingHead.reads, [[headPath]]);
  const stale = fixture();
  stale.setHead(43);
  await assert.rejects(stale.run, /stale or invalid/);
  assert.deepEqual(stale.reads, [[headPath], [manifestName, 64 * 1024]]);
  const moved = fixture();
  moved.manifest.objectName = "unapproved/object.json.gz";
  await assert.rejects(moved.run, /stale or invalid/);
  assert.equal(moved.reads.length, 2);
  const missing = fixture();
  missing.setManifestBytes(new Uint8Array());
  await assert.rejects(missing.run, /byte limit/);
  assert.equal(missing.reads.length, 2);
  const oversized = fixture();
  oversized.setManifestBytes(new Uint8Array(64 * 1024 + 1));
  await assert.rejects(oversized.run, /byte limit/);
  assert.equal(oversized.reads.length, 2);
  const corrupt = fixture();
  corrupt.setPayload(new Uint8Array(corrupt.manifest.compressedSize));
  await assert.rejects(corrupt.run, /hash check/);
  assert.equal(corrupt.reads.length, 3);
  const misleadingSize = fixture();
  misleadingSize.manifest.uncompressedSize = 1;
  await assert.rejects(misleadingSize.run, { code: "ERR_BUFFER_TOO_LARGE" });
  assert.equal(misleadingSize.reads.length, 3);
  const retired = fixture();
  retired.archive(first);
  await assert.rejects(retired.run, /disagrees with current/);
});

test("operator inventory refuses partial or unsafe grant scope at the count and transport bounds", async () => {
  const makeRows = (ids: string[]) => ids.map(canonicalId => ({ canonicalId, label: "Fictional site" }));
  const ids = Array.from({ length: 100 }, (_, index) => `oploc:fixture-${String(index).padStart(3, "0")}`);
  assert.deepEqual((await fixture({ oplocs: makeRows(ids) }).run()).ids, ids);
  await assert.rejects(fixture({ oplocs: makeRows([...ids, first]) }).run, /outside the supported scope/);
  await assert.rejects(fixture({ oplocs: makeRows(ids.map(id => id + "x".repeat(40))) }).run, /cannot fit/);
  await assert.rejects(fixture({ oplocs: makeRows([first, first]) }).run, /cannot fit/);
  await assert.rejects(fixture({ oplocs: makeRows(["oploc:*"]) }).run, /cannot fit/);
  await assert.rejects(fixture({ oplocs: makeRows([first]), redirects: { [first]: second } }).run, /cannot fit/);
});
