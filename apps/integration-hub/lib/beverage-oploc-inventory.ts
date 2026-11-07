import { gunzipSync } from "node:zlib";
import type { Firestore } from "firebase-admin/firestore";
import { immutableObjectName, sha256, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { MAX_BEVERAGE_OPLOC_SCOPE } from "./authmod-core/beverage-admission";
import { canonicalDocumentId, isActiveCanonicalOploc, type CanonicalOplocRecord } from "./canonical-oplocs";
import { db } from "./firebase-admin";
import { readCacheManifest } from "./integration-cache-server";
import { OPLOC_DATASET, OPLOC_MANIFEST_KEY, type OplocReadPackage } from "./oploc-read-package";

export const BEVERAGE_OPLOC_INVENTORY_BUCKET = "fika-os-dev-staging-read-packages-europe-west4";
const MANIFEST_NAME = `manifests/${OPLOC_MANIFEST_KEY}.json`;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_COMPRESSED_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TRANSPORT_LENGTH = 4096;
const TRANSPORT_ID = /^oploc:[A-Za-z0-9][A-Za-z0-9:_-]{0,153}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const ACTIVE_FIELDS = ["canonicalId", "entityType", "lifecycleStatus", "publicationStatus", "record.lifecycleState"];

export class BeverageOplocInventoryError extends Error {}

type InventoryDependencies = {
  firestore: Pick<Firestore, "runTransaction">;
  readObject(name: string, maxBytes: number): Promise<Uint8Array>;
};

function boundedLength(size: number, max: number) {
  return Number.isSafeInteger(size) && size > 0 && size <= max;
}

/** Operator evidence for one exact active OPLOC inventory. No recovery or account resolution. */
export function readBeverageOplocInventory({ firestore, readObject }: InventoryDependencies) {
  return firestore.runTransaction(async transaction => {
    const head = await readCacheManifest("oplocs", transaction);
    if (!Number.isSafeInteger(head.version) || head.version < 1) throw new BeverageOplocInventoryError("The canonical OPLOC head is unavailable.");
    const sourceVersion = `canonical-oplocs:${head.version}`;
    const rawManifest = await readObject(MANIFEST_NAME, MAX_MANIFEST_BYTES);
    if (!boundedLength(rawManifest.byteLength, MAX_MANIFEST_BYTES)) throw new BeverageOplocInventoryError("The OPLOC manifest is missing or exceeds its byte limit.");
    const manifest = JSON.parse(decoder.decode(rawManifest)) as ReadPackageManifest | null;
    if (!manifest || manifest.dataset !== OPLOC_DATASET || manifest.schemaVersion !== 1 ||
        manifest.contractVersion !== "integration-hub.oplocs.v2" || manifest.compression !== "gzip" ||
        manifest.sourceVersion !== sourceVersion || !Number.isSafeInteger(manifest.packageVersion) || manifest.packageVersion < 1 ||
        typeof manifest.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(manifest.contentHash) ||
        manifest.objectName !== immutableObjectName(OPLOC_DATASET, manifest.packageVersion, manifest.contentHash) ||
        !boundedLength(manifest.compressedSize, MAX_COMPRESSED_BYTES) || !boundedLength(manifest.uncompressedSize, MAX_JSON_BYTES)) {
      throw new BeverageOplocInventoryError("The OPLOC manifest is stale or invalid.");
    }
    const compressed = await readObject(manifest.objectName, manifest.compressedSize);
    if (compressed.byteLength !== manifest.compressedSize || sha256(compressed) !== manifest.contentHash) {
      throw new BeverageOplocInventoryError("The OPLOC object failed its byte count or hash check.");
    }
    const plain = gunzipSync(compressed, { maxOutputLength: manifest.uncompressedSize });
    if (plain.byteLength !== manifest.uncompressedSize) throw new BeverageOplocInventoryError("The OPLOC object failed its decoded byte count check.");
    const value = JSON.parse(decoder.decode(plain)) as OplocReadPackage | null;
    const redirects = value?.redirects ?? {};
    if (!Array.isArray(value?.oplocs) || !boundedLength(value.oplocs.length, MAX_BEVERAGE_OPLOC_SCOPE) ||
        typeof redirects !== "object" || Array.isArray(redirects) ||
        value.oplocs.length + Object.keys(redirects).length !== manifest.recordCount) {
      throw new BeverageOplocInventoryError("The current OPLOC inventory is missing, invalid or outside the supported scope.");
    }
    const ids = value.oplocs.map(row => row?.canonicalId);
    if (ids.some(id => typeof id !== "string" || !TRANSPORT_ID.test(id) || Object.hasOwn(redirects, id)) ||
        new Set(ids).size !== ids.length || ids.join(",").length > MAX_TRANSPORT_LENGTH) {
      throw new BeverageOplocInventoryError("The complete canonical OPLOC inventory cannot fit the Beverage transport.");
    }
    ids.sort();
    const refs = ids.map(id => db.collection("integrationHubCanonical").doc(canonicalDocumentId(id)));
    const documents = await transaction.getAll(...refs, { fieldMask: ACTIVE_FIELDS });
    if (documents.length !== ids.length || !documents.every((document, index) => {
      const canonical = document.data() as CanonicalOplocRecord | undefined;
      return canonical?.canonicalId === ids[index] && isActiveCanonicalOploc(canonical);
    })) throw new BeverageOplocInventoryError("The OPLOC package disagrees with current canonical active records.");
    return {
      sourceVersion, packageVersion: manifest.packageVersion, contentHash: manifest.contentHash,
      inventoryHash: sha256(JSON.stringify(ids)), count: ids.length, ids,
    };
  }, { readOnly: true });
}
