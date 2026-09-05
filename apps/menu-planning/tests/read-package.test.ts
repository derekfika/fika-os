import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeReadPackage, encodeReadPackage, immutableObjectName } from "@fika/server-shared/read-package";
import { getCatalogueReadPackage } from "../lib/catalogue-read-package";

test("read packages are immutable gzip objects with verifiable hashes", () => {
  const encoded = encodeReadPackage("snapshots/menu-planning/catalogue", 7, { entries: [{ id: "dish-1" }] }, 1);
  assert.equal(encoded.manifest.packageVersion, 7);
  assert.match(encoded.manifest.objectName, /v7-[a-f0-9]{64}\.json\.gz$/);
  assert.equal(encoded.manifest.objectName, immutableObjectName(encoded.manifest.dataset, 7, encoded.manifest.contentHash));
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), { entries: [{ id: "dish-1" }] });
  const corrupt = Uint8Array.from(encoded.bytes); corrupt[0] ^= 1;
  assert.throws(() => decodeReadPackage(encoded.manifest, corrupt), /integrity check failed/);
});

test("missing catalogue packages rebuild from canonical data while corruption fails closed", async () => {
  let publishes = 0;
  const encoded = encodeReadPackage("snapshots/menu-planning/catalogue", 2, { entries: [], categories: [] }, 0);
  const corruptStore = { async getManifest() { return encoded.manifest; }, async get() { return new Uint8Array([1, 2, 3]); }, async has() { return true; }, async putImmutable() { publishes += 1; }, async putManifest() { publishes += 1; } };
  await assert.rejects(() => getCatalogueReadPackage(corruptStore), /integrity check failed/);
  assert.equal(publishes, 0);
});

test("normal catalogue GET delegates missing and stale package recovery to the bounded read helper", async () => {
  const route = await (await import("node:fs/promises")).readFile(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  const helper = await (await import("node:fs/promises")).readFile(new URL("../lib/catalogue-read-package.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /listCatalogueEntries\(|publishCataloguePackage\(/);
  assert.match(helper, /listCatalogueEntries\(/);
  assert.match(helper, /sourceManifest\.catalogueVersion > retrieved\.manifest\.packageVersion/);
  assert.match(helper, /publishCataloguePackage\(entries, store\)/);
});

test("hosted catalogue package downloads preserve compressed bytes", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../lib/catalogue-package-store.ts", import.meta.url), "utf8");
  assert.match(source, /download\(\{ decompress: false \}\)/);
});
