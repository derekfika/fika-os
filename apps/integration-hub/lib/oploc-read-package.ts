import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { decodeReadPackage, encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { formatAddress } from "./address";
import { isActiveCanonicalOploc } from "./canonical-oplocs";
import { readCacheManifest } from "./integration-cache-server";
import { buildOplocRedirects, legacyOplocIds } from "./oploc-redirects";

export const OPLOC_DATASET = "integration-hub/oplocs";
export const OPLOC_MANIFEST_KEY = "integration-hub/oplocs";
export type OplocReadRecord = { canonicalId: string; label: string; lifecycleStatus?: string; publicationStatus?: string; locationType?: string; address?: string; legacyIds?: string[] };
export type OplocReadPackage = { oplocs: OplocReadRecord[]; redirects?: Record<string, string> };

const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const localRoot = () => process.env.FIKA_SNAPSHOT_DIR || path.join(process.cwd(), "local-data", "read-packages");

function localStore(): ReadPackageStore {
  const file = (name: string) => path.join(localRoot(), name);
  return {
    async putImmutable(name, bytes) { const target = file(name); await mkdir(path.dirname(target), { recursive: true }); try { await readFile(target); } catch { await writeFile(target, bytes); } },
    async get(name) { try { return await readFile(file(name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async has(name) { return Boolean(await this.get(name)); },
    async getManifest(key) { try { return JSON.parse(await readFile(file(`manifests/${key.replaceAll("/", "_")}.json`), "utf8")) as ReadPackageManifest; } catch { return undefined; } },
    async putManifest(key, manifest) { const target = file(`manifests/${key.replaceAll("/", "_")}.json`); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(manifest, null, 2)); },
  };
}

function cloudStore(): ReadPackageStore {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!projectId || !bucketName) throw Object.assign(new Error("Integration Hub OPLOC package storage is not configured."), { status: 503, code: "OPLOC_PACKAGE_STORAGE_NOT_CONFIGURED" });
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: bucketName });
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async putImmutable(name, bytes, contentHash) { const object = bucket.file(name); const [exists] = await object.exists(); if (!exists) await object.save(Buffer.from(bytes), { resumable: false, metadata: { contentType: "application/json", contentEncoding: "gzip", metadata: { contentHash } } }); },
    // Integrity hashes cover the stored gzip bytes. The Storage client defaults
    // to transparent decompression for objects marked contentEncoding=gzip.
    async get(name) { try { const [bytes] = await bucket.file(name).download({ decompress: false }); return bytes; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async has(name) { const [exists] = await bucket.file(name).exists(); return exists; },
    async getManifest(key) { try { const [bytes] = await bucket.file(`manifests/${key}.json`).download(); return JSON.parse(bytes.toString("utf8")) as ReadPackageManifest; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async putManifest(key, manifest) { await bucket.file(`manifests/${key}.json`).save(JSON.stringify(manifest), { resumable: false, metadata: { contentType: "application/json" } }); },
  };
}

export function oplocPackageStore() { return hosted() ? cloudStore() : localStore(); }

export async function rebuildOplocReadPackage(): Promise<ReadPackageManifest> {
  const cacheManifest = await readCacheManifest("oplocs");
  const records = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get();
  const all = records.docs.map(document => document.data() as { canonicalId?: string; entityType?: string; lifecycleStatus?: string; publicationStatus?: string; record?: Record<string, unknown> });
  const redirects = buildOplocRedirects(all as unknown as Parameters<typeof buildOplocRedirects>[0]);
  const active = all.filter(isActiveCanonicalOploc);
  const addressIds = [...new Set(active.map(value => String(value.record?.addressReference || "")).filter(Boolean))];
  const addresses = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < addressIds.length; index += 30) {
    const snapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "Address").where("canonicalId", "in", addressIds.slice(index, index + 30)).get();
    for (const document of snapshot.docs) { const value = document.data() as { canonicalId?: string; record?: Record<string, unknown> }; if (value.canonicalId) addresses.set(value.canonicalId, value.record || {}); }
  }
  recordDataAccess({ app: "integration-hub", operation: "oploc.package.rebuild", source: "FIRESTORE", documents: records.size + addresses.size });
  const oplocs = active.map(value => { const record = value.record || {}; const address = record.addressReference ? formatAddress(addresses.get(String(record.addressReference)) || {}) : ""; const legacyIds = legacyOplocIds(redirects, value.canonicalId!); return { canonicalId: value.canonicalId!, label: String(record.approvedName || value.canonicalId!).trim(), ...(value.lifecycleStatus ? { lifecycleStatus: value.lifecycleStatus } : {}), ...(value.publicationStatus ? { publicationStatus: value.publicationStatus } : {}), ...(record.locationType ? { locationType: String(record.locationType) } : {}), ...(address ? { address } : {}), ...(legacyIds.length ? { legacyIds } : {}) }; }).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
  const store = oplocPackageStore();
  const previous = await store.getManifest(OPLOC_MANIFEST_KEY);
  const encoded = encodeReadPackage(OPLOC_DATASET, (previous?.packageVersion || 0) + 1, { oplocs, redirects }, oplocs.length + Object.keys(redirects).length, { contractVersion: "integration-hub.oplocs.v2", sourceVersion: `canonical-oplocs:${cacheManifest.version}` });
  return publishReadPackage<OplocReadPackage>(store, OPLOC_MANIFEST_KEY, encoded);
}

export async function getOplocReadPackage() {
  const store = oplocPackageStore();
  let result;
  try {
    result = await retrieveReadPackage<OplocReadPackage>(store, OPLOC_MANIFEST_KEY);
  } catch (error) {
    recordDataAccess({ app: "integration-hub", operation: "oploc.package.integrity-failure", source: "SNAPSHOT", documents: 0 });
    throw Object.assign(new Error("OPLOC read package integrity validation failed. Rebuild the package before serving traffic."), { status: 503, code: "OPLOC_PACKAGE_INTEGRITY_FAILURE", cause: error });
  }
  if (!result) throw Object.assign(new Error("OPLOC read package is unavailable."), { status: 503, code: "OPLOC_PACKAGE_MISSING" });
  const cacheManifest = await readCacheManifest("oplocs");
  if (result.manifest.sourceVersion !== `canonical-oplocs:${cacheManifest.version}`) {
    throw Object.assign(new Error("OPLOC read package is stale. Rebuild the package before serving traffic."), { status: 503, code: "OPLOC_PACKAGE_STALE" });
  }
  recordDataAccess({ app: "integration-hub", operation: "oploc.package.read", source: "SNAPSHOT", documents: result.manifest.recordCount, cacheHit: false });
  return result;
}

export function validateOplocReadPackage(value: OplocReadPackage) { if (!value || !Array.isArray(value.oplocs)) throw new Error("Invalid OPLOC read package payload."); return { ...value, redirects: value.redirects || {} }; }
