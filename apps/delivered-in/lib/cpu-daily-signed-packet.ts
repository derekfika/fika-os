import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import {
  assertDailyAllergenPacket,
  assertDailySignedOplocBundle,
  dailyBundleManifestKey,
  DAILY_SIGNED_OPLOC_BUNDLE_DATASET,
  DAILY_SIGNED_OPLOC_BUNDLE_PACKAGE_CONTRACT,
  type DailyAllergenPacket,
  type DailySignedOplocBundle,
  type DailySignedOplocBundlePackage,
} from "@fika/server-shared/daily-signed-oploc-bundle";
import { retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Consumer-side view of the one shared CPU daily bundle package. */
export const CPU_DAILY_PACKET_DATASET = DAILY_SIGNED_OPLOC_BUNDLE_DATASET;
export const CPU_DAILY_PACKET_CONTRACT = DAILY_SIGNED_OPLOC_BUNDLE_PACKAGE_CONTRACT;
export const cpuDailyPacketManifestKey = dailyBundleManifestKey;

export type CpuDailyPacketReviewEntry = { allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded">; allergenState: DailyAllergenPacket["items"][number]["allergenState"]; mayContainNotes?: string };
export type CpuDailySignedPacket = {
  bundle: DailySignedOplocBundle;
  packet: DailyAllergenPacket;
  manifest: ReadPackageManifest;
  sourceBundleHash: string;
  signedPdfUrl: string;
  signedPdfContentHash: string;
};

const localRoot = () => process.env.FIKA_SNAPSHOT_DIR || path.join(process.cwd(), "local-data", "read-packages");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const invalid = (message: string) => Object.assign(new Error(message), { code: "CPU_DAILY_PACKET_INVALID", status: 503 });

function localStore(): ReadPackageStore {
  const file = (name: string) => path.join(localRoot(), name);
  return {
    async putImmutable(name, bytes) { const target = file(name); await mkdir(path.dirname(target), { recursive: true }); try { await readFile(target); } catch { await writeFile(target, bytes); } },
    async get(name) { try { return await readFile(file(name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async has(name) { return Boolean(await this.get(name)); },
    async getManifest(key) { try { return JSON.parse(await readFile(file(`manifests/${key.replaceAll("/", "_")}.json`), "utf8")) as ReadPackageManifest; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async putManifest(key, manifest) { const target = file(`manifests/${key.replaceAll("/", "_")}.json`); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(manifest, null, 2)); },
  };
}

function cloudStore(): ReadPackageStore {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!projectId || !bucketName) throw invalid("CPU daily packet storage is not configured.");
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: bucketName });
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async putImmutable(name, bytes, contentHash) { const object = bucket.file(name); const [exists] = await object.exists(); if (!exists) await object.save(Buffer.from(bytes), { resumable: false, metadata: { contentType: "application/json", contentEncoding: "gzip", metadata: { contentHash } } }); },
    async get(name) { try { const [bytes] = await bucket.file(name).download(); return bytes; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async has(name) { const [exists] = await bucket.file(name).exists(); return exists; },
    async getManifest(key) { try { const [bytes] = await bucket.file(`manifests/${key}.json`).download(); return JSON.parse(bytes.toString("utf8")) as ReadPackageManifest; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async putManifest(key, manifest) { await bucket.file(`manifests/${key}.json`).save(JSON.stringify(manifest), { resumable: false, metadata: { contentType: "application/json" } }); },
  };
}

const packetStore = () => hosted() ? cloudStore() : localStore();

function packetEntries(packet: DailyAllergenPacket) {
  return new Map(packet.items.map(item => {
    const allergens: CpuDailyPacketReviewEntry["allergens"] = {};
    for (const name of item.allergenNames) allergens[name] = "contains";
    for (const name of item.mayContainAllergenNames) allergens[name] = "may_contain";
    return [item.menuItemId, { allergens, allergenState: item.allergenState, ...(item.allergenState === "unrecorded" ? { mayContainNotes: "Allergen evidence is unrecorded." } : {}) }];
  }));
}

export async function readCpuDailySignedPacket(serviceDate: string, oplocId: string, expectedSourceBundleHash: string): Promise<CpuDailySignedPacket | undefined> {
  const retrieved = await retrieveReadPackage<DailySignedOplocBundlePackage>(packetStore(), cpuDailyPacketManifestKey(serviceDate, oplocId));
  if (!retrieved) return undefined;
  if (retrieved.manifest.dataset !== CPU_DAILY_PACKET_DATASET || retrieved.manifest.contractVersion !== CPU_DAILY_PACKET_CONTRACT || retrieved.manifest.scope !== `${oplocId}:${serviceDate}`) throw invalid("CPU daily packet manifest contract or scope is unsupported.");
  const value = retrieved.value;
  if (!value?.bundle || !value.packet) throw invalid("CPU daily packet envelope is incomplete.");
  const bundle = assertDailySignedOplocBundle(value.bundle);
  const packet = assertDailyAllergenPacket(value.packet);
  if (bundle.status !== "published" || packet.bundleId !== bundle.bundleId || packet.serviceDate !== serviceDate || packet.oploc.id !== oplocId || packet.source.revision !== bundle.source.revision || packet.source.contentHash !== expectedSourceBundleHash || bundle.source.contentHash !== expectedSourceBundleHash || packet.contentHash !== bundle.packet.contentHash) throw invalid("CPU daily packet scope, source hash, or bundle binding does not match the published Menu Planning day.");
  if (bundle.pdf.contentHash.length !== 64 || !bundle.pdf.fileId || !bundle.pdf.url) throw invalid("CPU daily packet has no durable signed PDF identity and URL.");
  return { bundle, packet, manifest: retrieved.manifest, sourceBundleHash: bundle.source.contentHash, signedPdfUrl: bundle.pdf.url, signedPdfContentHash: bundle.pdf.contentHash };
}

export function cpuDailyPacketReview(packet: CpuDailySignedPacket) {
  return {
    entries: packetEntries(packet.packet),
    cpuReview: { status: "signed" as const, signatures: packet.bundle.signatures, drivePdfUrl: packet.signedPdfUrl },
    orderIds: [],
    package: { packageVersion: packet.manifest.packageVersion, contentHash: packet.manifest.contentHash, sourceBundleHash: packet.sourceBundleHash, sourceVersion: packet.manifest.sourceVersion, contractVersion: packet.manifest.contractVersion, sourceCompleteness: "complete" as const, sourceStatus: "current" as const, generatedAt: packet.manifest.generatedAt },
  };
}
