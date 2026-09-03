import assert from "node:assert/strict";
import test from "node:test";
import type { ReadPackageManifest, ReadPackageStore } from "@fika/server-shared/read-package";
import { getGrabAndGoCatalogueManifest, getGrabAndGoCataloguePackage, publishGrabAndGoCatalogue } from "../lib/grab-and-go-catalogue-package";
import type { GrabAndGoProductContract } from "@fika/server-shared/grab-and-go-catalogue";

const product: GrabAndGoProductContract = { productId: "grab:test-pot", name: "Test Pot", category: "grab_250ml", rotationWeeks: [1], allowedDeliveryWeekdays: ["Monday"], price: 1.85, active: true, sortOrder: 1 };
function store(): ReadPackageStore {
  const objects = new Map<string, Uint8Array>(); const manifests = new Map<string, ReadPackageManifest>();
  return { async putImmutable(name, bytes) { if (!objects.has(name)) objects.set(name, bytes); }, async get(name) { return objects.get(name); }, async has(name) { return objects.has(name); }, async getManifest(key) { return manifests.get(key); }, async putManifest(key, manifest) { manifests.set(key, manifest); } };
}

test("Grab & Go catalogue publishes as an immutable validated CPU-owned package", async () => {
  const target = store();
  const first = await publishGrabAndGoCatalogue([product], target);
  const second = await publishGrabAndGoCatalogue([{ ...product, name: "Updated Test Pot" }], target);
  assert.equal(first.packageVersion, 1);
  assert.equal(second.packageVersion, 2);
  assert.notEqual(first.objectName, second.objectName);
  const retrieved = await getGrabAndGoCataloguePackage(target);
  assert.equal(retrieved.manifest.packageVersion, 2);
  assert.equal(retrieved.value.products[0].name, "Updated Test Pot");
  assert.equal((await getGrabAndGoCatalogueManifest(target)).contentHash, second.contentHash);
});

test("Grab & Go catalogue rejects missing and corrupt packages without fallback data", async () => {
  const missing = store();
  await assert.rejects(() => getGrabAndGoCataloguePackage(missing), (error: any) => error.code === "GRAB_AND_GO_CATALOGUE_UNAVAILABLE" && error.status === 503);
  const target = store(); const encoded = await publishGrabAndGoCatalogue([product], target);
  const corrupt: ReadPackageStore = { async putImmutable() {}, async get() { return new Uint8Array([1, 2, 3]); }, async has() { return true; }, async getManifest() { return encoded; }, async putManifest() {} };
  await assert.rejects(() => getGrabAndGoCataloguePackage(corrupt), /integrity check failed/i);
});
