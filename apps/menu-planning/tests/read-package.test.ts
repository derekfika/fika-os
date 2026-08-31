import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeReadPackage, encodeReadPackage, immutableObjectName } from "@fika/server-shared/read-package";

test("read packages are immutable gzip objects with verifiable hashes", () => {
  const encoded = encodeReadPackage("snapshots/menu-planning/catalogue", 7, { entries: [{ id: "dish-1" }] }, 1);
  assert.equal(encoded.manifest.packageVersion, 7);
  assert.match(encoded.manifest.objectName, /v7-[a-f0-9]{64}\.json\.gz$/);
  assert.equal(encoded.manifest.objectName, immutableObjectName(encoded.manifest.dataset, 7, encoded.manifest.contentHash));
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), { entries: [{ id: "dish-1" }] });
  const corrupt = Uint8Array.from(encoded.bytes); corrupt[0] ^= 1;
  assert.throws(() => decodeReadPackage(encoded.manifest, corrupt), /integrity check failed/);
});
