import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const WEEKLY_PUBLICATION_PACKET_DATASET = "menu-planning.published-week";
export const WEEKLY_PUBLICATION_PACKET_CONTRACT_VERSION = "1.0.0";
export const WEEKLY_PUBLICATION_PACKET_SCHEMA_VERSION = 1;
export const MAX_WEEKLY_PUBLICATION_PACKET_BYTES = 700 * 1024;

export type WeeklyPublicationPacketManifest = {
  dataset: typeof WEEKLY_PUBLICATION_PACKET_DATASET;
  packageVersion: number;
  schemaVersion: number;
  contractVersion: string;
  compression: "gzip";
  contentHash: string;
  compressedSize: number;
  uncompressedSize: number;
  recordCount: number;
  generatedAt: string;
  sourceVersion: string;
  scope: string;
};

/**
 * The transport envelope is intentionally self-contained so a downstream app
 * can read one Firestore document and decode the complete published week.
 * payloadBase64 is the gzip-compressed JSON payload, not a second per-day
 * fetch protocol.
 */
export type WeeklyPublicationPacket<T = unknown> = {
  manifest: WeeklyPublicationPacketManifest;
  payloadBase64: string;
  payload?: T;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value);

export function encodeWeeklyPublicationPacket<T extends { publicationId: string; publicationVersion: number; sourceWeekId: string; sourceWeekVersion: number; days: unknown[] }>(payload: T, generatedAt = new Date().toISOString()): WeeklyPublicationPacket<T> {
  const plain = Buffer.from(json(payload), "utf8");
  const compressed = gzipSync(plain, { level: 9 });
  if (compressed.byteLength > MAX_WEEKLY_PUBLICATION_PACKET_BYTES) throw Object.assign(new Error(`The weekly publication packet exceeds the ${MAX_WEEKLY_PUBLICATION_PACKET_BYTES} byte safety limit.`), { status: 413 });
  const manifest: WeeklyPublicationPacketManifest = {
    dataset: WEEKLY_PUBLICATION_PACKET_DATASET,
    packageVersion: payload.publicationVersion,
    schemaVersion: WEEKLY_PUBLICATION_PACKET_SCHEMA_VERSION,
    contractVersion: WEEKLY_PUBLICATION_PACKET_CONTRACT_VERSION,
    compression: "gzip",
    contentHash: sha256(compressed),
    compressedSize: compressed.byteLength,
    uncompressedSize: plain.byteLength,
    recordCount: payload.days.length,
    generatedAt,
    sourceVersion: `${payload.sourceWeekId}:v${payload.sourceWeekVersion}`,
    scope: payload.sourceWeekId,
  };
  return { manifest, payloadBase64: compressed.toString("base64") };
}

export function decodeWeeklyPublicationPacket<T>(packet: WeeklyPublicationPacket<T>): T {
  if (!packet || !packet.manifest || typeof packet.payloadBase64 !== "string") throw new Error("Weekly publication packet is malformed.");
  if (packet.manifest.dataset !== WEEKLY_PUBLICATION_PACKET_DATASET || packet.manifest.compression !== "gzip" || packet.manifest.schemaVersion !== WEEKLY_PUBLICATION_PACKET_SCHEMA_VERSION || packet.manifest.contractVersion !== WEEKLY_PUBLICATION_PACKET_CONTRACT_VERSION) throw new Error("Weekly publication packet manifest is unsupported.");
  const compressed = Buffer.from(packet.payloadBase64, "base64");
  if (compressed.byteLength !== packet.manifest.compressedSize || sha256(compressed) !== packet.manifest.contentHash) throw new Error("Weekly publication packet integrity check failed.");
  const plain = gunzipSync(compressed);
  if (plain.byteLength !== packet.manifest.uncompressedSize) throw new Error("Weekly publication packet size check failed.");
  return JSON.parse(plain.toString("utf8")) as T;
}
