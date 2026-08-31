import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export type ReadPackageCompression = "gzip";
export type ReadPackageManifest = {
  dataset: string;
  packageVersion: number;
  schemaVersion: number;
  contractVersion: string;
  objectName: string;
  compression: ReadPackageCompression;
  contentHash: string;
  compressedSize: number;
  uncompressedSize: number;
  recordCount: number;
  generatedAt: string;
  sourceVersion?: string;
  scope?: string;
};

export type ReadPackageStore = {
  putImmutable(name: string, bytes: Uint8Array, contentHash: string): Promise<void>;
  get(name: string): Promise<Uint8Array | undefined>;
  has(name: string): Promise<boolean>;
  getManifest(key: string): Promise<ReadPackageManifest | undefined>;
  putManifest(key: string, manifest: ReadPackageManifest): Promise<void>;
};

export function canonicalJson(value: unknown) { return JSON.stringify(value); }
export function sha256(bytes: Uint8Array | string) { return createHash("sha256").update(bytes).digest("hex"); }
export function immutableObjectName(dataset: string, version: number, contentHash: string) { return `${dataset}/v${version}-${contentHash}.json.gz`; }

export function encodeReadPackage<T>(dataset: string, version: number, value: T, recordCount: number, options: { schemaVersion?: number; contractVersion?: string; sourceVersion?: string; scope?: string } = {}) {
  const plain = Buffer.from(canonicalJson(value), "utf8");
  const compressed = gzipSync(plain, { level: 9 });
  const contentHash = sha256(compressed);
  const manifest: ReadPackageManifest = {
    dataset, packageVersion: version, schemaVersion: options.schemaVersion || 1, contractVersion: options.contractVersion || "1.0.0",
    objectName: immutableObjectName(dataset, version, contentHash), compression: "gzip", contentHash,
    compressedSize: compressed.byteLength, uncompressedSize: plain.byteLength, recordCount, generatedAt: new Date().toISOString(),
    ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {}), ...(options.scope ? { scope: options.scope } : {}),
  };
  return { manifest, bytes: compressed };
}

export function decodeReadPackage<T>(manifest: ReadPackageManifest, bytes: Uint8Array): T {
  if (sha256(bytes) !== manifest.contentHash) throw new Error(`Read package integrity check failed for ${manifest.dataset} v${manifest.packageVersion}.`);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as T;
}

export async function publishReadPackage<T>(store: ReadPackageStore, manifestKey: string, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }) {
  await store.putImmutable(encoded.manifest.objectName, encoded.bytes, encoded.manifest.contentHash);
  const persisted = await store.get(encoded.manifest.objectName);
  if (!persisted) throw new Error(`Read package ${encoded.manifest.objectName} was not persisted.`);
  decodeReadPackage<T>(encoded.manifest, persisted);
  await store.putManifest(manifestKey, encoded.manifest);
  return encoded.manifest;
}

export async function retrieveReadPackage<T>(store: ReadPackageStore, manifestKey: string) {
  const manifest = await store.getManifest(manifestKey);
  if (!manifest) return undefined;
  const bytes = await store.get(manifest.objectName);
  if (!bytes) throw new Error(`Read package ${manifest.objectName} is unavailable.`);
  return { manifest, value: decodeReadPackage<T>(manifest, bytes) };
}
