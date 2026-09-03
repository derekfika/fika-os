import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { ReadPackageManifest, ReadPackageStore } from "@fika/server-shared/read-package";

const localRoot = () => process.env.FIKA_SNAPSHOT_DIR || path.join(process.cwd(), "local-data", "read-packages");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");

export async function downloadCpuPackageBytes(file: { download(options?: { decompress?: boolean }): Promise<[Buffer]> }) {
  const [bytes] = await file.download({ decompress: false });
  return bytes;
}

function localStore(): ReadPackageStore {
  const file = (name: string) => path.join(localRoot(), name);
  return {
    async putImmutable(name, bytes) { const target = file(name); await mkdir(path.dirname(target), { recursive: true }); try { await readFile(target); } catch { await writeFile(target, bytes); } },
    async get(name) { try { return await readFile(file(name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async has(name) { try { await readFile(file(name)); return true; } catch { return false; } },
    async getManifest(key) { try { return JSON.parse(await readFile(file(`manifests/${key.replaceAll("/", "_")}.json`), "utf8")) as ReadPackageManifest; } catch { return undefined; } },
    async putManifest(key, manifest) { const target = file(`manifests/${key.replaceAll("/", "_")}.json`); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(manifest, null, 2)); },
  };
}

function cloudStore(): ReadPackageStore {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!projectId || !bucketName) throw Object.assign(new Error("CPU projection package storage is not configured."), { status: 503, code: "CPU_PACKAGE_STORAGE_NOT_CONFIGURED" });
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: bucketName });
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async putImmutable(name, bytes, contentHash) { const object = bucket.file(name); const [exists] = await object.exists(); if (exists) return; await object.save(Buffer.from(bytes), { resumable: false, metadata: { contentType: "application/json", contentEncoding: "gzip", metadata: { contentHash } } }); },
    // Read-package hashes cover the stored compressed bytes.  GCS otherwise
    // transparently decodes objects carrying contentEncoding=gzip, which
    // makes the integrity check fail after a successful upload and prevents
    // the manifest from being published.
    async get(name) { try { return await downloadCpuPackageBytes(bucket.file(name)); } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async has(name) { const [exists] = await bucket.file(name).exists(); return exists; },
    async getManifest(key) { const [bytes] = await bucket.file(`manifests/${key}.json`).download().catch(() => [undefined] as const); return bytes ? JSON.parse(bytes.toString("utf8")) as ReadPackageManifest : undefined; },
    async putManifest(key, manifest) { await bucket.file(`manifests/${key}.json`).save(JSON.stringify(manifest), { resumable: false, metadata: { contentType: "application/json" } }); },
  };
}

export function cpuPackageStore() { return hosted() ? cloudStore() : localStore(); }
