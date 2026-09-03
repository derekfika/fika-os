import { createHash } from "node:crypto";
import { canonicalOplocId } from "@fika/server-shared/governed-oplocs";
import { gunzipSync } from "node:zlib";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import type { SourcePublication } from "./projection";

/**
 * Local server-side adapter for the Menu Planning published-week packet.
 * It intentionally does not import Menu Planning code or expose Firestore to
 * the browser. The plain compiled snapshot is retained as a compatibility
 * fallback while packet documents roll out.
 */
export const MENU_PLANNING_WEEK_PACKET_COLLECTION = "fikaMenuPlanningWeekPackets";
export const MENU_PLANNING_PUBLICATIONS_COLLECTION = "fikaMenuPlanningPublications";
export const MENU_PLANNING_SNAPSHOTS_COLLECTION = "fikaMenuPlanningPublishedSnapshots";

export type MenuPlanningWeekPacketEntry = { sourceEntryId: string; slot: string; canonicalDishId?: string; dishName: string; portions: number; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }>; allergens?: Record<string, string>; mayContainNotes?: string };
export type MenuPlanningWeekPacketDay = { publicationDayId: string; sourceDayId: string; date: string; dayName: string; version: number; status?: "published" | "superseded" | "withdrawn"; contentHash?: string; entries: MenuPlanningWeekPacketEntry[]; allergenSignoff?: Record<string, unknown> };
export type MenuPlanningWeekPacket = { schemaVersion: number; publicationId: string; sourceWeekId: string; publicationVersion?: number; contentHash?: string; week: { weekCommencing: string; weekEnding: string }; days: MenuPlanningWeekPacketDay[] };
type PacketDocument = { packet?: unknown; payload?: unknown; payloadBase64?: unknown; encoding?: unknown; contentHash?: unknown; compressedSize?: unknown; uncompressedSize?: unknown; [key: string]: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const invalid = (message: string) => Object.assign(new Error(message), { code: "MENU_PLANNING_WEEK_PACKET_INVALID", status: 502 });
const decodedPacketCache = new Map<string, MenuPlanningWeekPacket>();
type PublishedAllergenState = "clear" | "contains" | "may_contain";
function safeAllergens(value: Record<string, string> | undefined): Record<string, PublishedAllergenState> {
  const result: Record<string, PublishedAllergenState> = {};
  for (const [key, state] of Object.entries(value || {})) {
    if (state !== "clear" && state !== "contains" && state !== "may_contain") throw invalid("The Menu Planning weekly packet contains an invalid allergen state.");
    result[key] = state;
  }
  return result;
}

function validate(value: unknown, expectedPublicationId?: string): MenuPlanningWeekPacket {
  if (!isRecord(value) || typeof value.publicationId !== "string" || typeof value.sourceWeekId !== "string" || !isRecord(value.week) || !isDate(value.week.weekCommencing) || !isDate(value.week.weekEnding) || !Array.isArray(value.days)) throw invalid("The Menu Planning weekly packet has an invalid shape.");
  if (expectedPublicationId && value.publicationId !== expectedPublicationId) throw invalid("The Menu Planning weekly packet publication identity does not match the requested publication.");
  const days = value.days.map((day): MenuPlanningWeekPacketDay => {
    const dayVersion = day && typeof day === "object" && "version" in day ? day.version : undefined;
    if (!isRecord(day) || typeof day.publicationDayId !== "string" || typeof day.sourceDayId !== "string" || !isDate(day.date) || typeof day.dayName !== "string" || typeof dayVersion !== "number" || !Number.isInteger(dayVersion) || dayVersion < 1 || !Array.isArray(day.entries)) throw invalid("The Menu Planning weekly packet contains an invalid service day.");
    const entries = day.entries.map((entry): MenuPlanningWeekPacketEntry => {
      const entryPortions = entry && typeof entry === "object" && "portions" in entry ? entry.portions : undefined;
      if (!isRecord(entry) || typeof entry.sourceEntryId !== "string" || typeof entry.slot !== "string" || typeof entry.dishName !== "string" || typeof entryPortions !== "number" || !Number.isFinite(entryPortions) || entryPortions < 0 || !Array.isArray(entry.allocations)) throw invalid("The Menu Planning weekly packet contains an invalid menu entry.");
      const allocations = entry.allocations.map(allocation => {
        const allocationQuantity = allocation && typeof allocation === "object" && "quantity" in allocation ? allocation.quantity : undefined;
        if (!isRecord(allocation) || (allocation.destinationId !== undefined && typeof allocation.destinationId !== "string") || typeof allocation.destinationLabel !== "string" || typeof allocationQuantity !== "number" || !Number.isFinite(allocationQuantity) || allocationQuantity < 0) throw invalid("The Menu Planning weekly packet contains an invalid portion allocation.");
        return { ...(allocation.destinationId !== undefined ? { destinationId: canonicalOplocId(allocation.destinationId) } : {}), destinationLabel: allocation.destinationLabel, quantity: allocationQuantity };
      });
      return { sourceEntryId: entry.sourceEntryId, slot: entry.slot, ...(typeof entry.canonicalDishId === "string" ? { canonicalDishId: entry.canonicalDishId } : {}), dishName: entry.dishName, portions: entryPortions, allocations, ...(isRecord(entry.allergens) ? { allergens: Object.fromEntries(Object.entries(entry.allergens).filter(([, state]) => typeof state === "string").map(([key, state]) => [key, state as string])) } : {}), ...(typeof entry.mayContainNotes === "string" ? { mayContainNotes: entry.mayContainNotes } : {}) };
    });
    return { publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, date: day.date, dayName: day.dayName, version: dayVersion, ...(day.status === "published" || day.status === "superseded" || day.status === "withdrawn" ? { status: day.status } : {}), ...(typeof day.contentHash === "string" ? { contentHash: day.contentHash } : {}), entries, ...(isRecord(day.allergenSignoff) ? { allergenSignoff: day.allergenSignoff } : {}) };
  });
  return { schemaVersion: Number(value.schemaVersion || 1), publicationId: value.publicationId, sourceWeekId: value.sourceWeekId, ...(typeof value.publicationVersion === "number" && Number.isInteger(value.publicationVersion) ? { publicationVersion: value.publicationVersion } : {}), ...(typeof value.contentHash === "string" ? { contentHash: value.contentHash } : {}), week: { weekCommencing: value.week.weekCommencing, weekEnding: value.week.weekEnding }, days };
}

function decodeCompressed(document: PacketDocument, expectedPublicationId?: string) {
  const envelope = isRecord(document.packet) ? document.packet : document;
  const manifest = isRecord(envelope.manifest) ? envelope.manifest : envelope;
  const payload = envelope.payloadBase64 ?? envelope.payload;
  const contentHash = typeof envelope.contentHash === "string" ? envelope.contentHash : manifest.contentHash;
  const compressedSize = envelope.compressedSize ?? manifest.compressedSize;
  const uncompressedSize = envelope.uncompressedSize ?? manifest.uncompressedSize;
  const compressedEncoding = envelope.encoding === "gzip+base64" || manifest.compression === "gzip";
  if (!compressedEncoding || typeof payload !== "string" || typeof contentHash !== "string") throw invalid("The Menu Planning weekly packet is missing its gzip/base64 integrity metadata.");
  let compressed: Buffer;
  try { compressed = Buffer.from(payload, "base64"); if (!compressed.length || compressed.toString("base64").replace(/=+$/, "") !== payload.replace(/=+$/, "")) throw new Error("invalid base64"); } catch { throw invalid("The Menu Planning weekly packet contains invalid base64 data."); }
  if (sha256(compressed) !== contentHash) throw invalid("The Menu Planning weekly packet failed its SHA-256 integrity check.");
  const cached = decodedPacketCache.get(contentHash);
  if (cached) {
    if (expectedPublicationId && cached.publicationId !== expectedPublicationId) throw invalid("The Menu Planning weekly packet publication identity does not match the requested publication.");
    return cached;
  }
  if (Number.isInteger(compressedSize) && compressedSize !== compressed.byteLength) throw invalid("The Menu Planning weekly packet compressed size is incorrect.");
  let plain: Buffer;
  try { plain = gunzipSync(compressed); } catch { throw invalid("The Menu Planning weekly packet is not valid gzip data."); }
  if (Number.isInteger(uncompressedSize) && uncompressedSize !== plain.byteLength) throw invalid("The Menu Planning weekly packet uncompressed size is incorrect.");
  let decoded: unknown;
  try { decoded = JSON.parse(plain.toString("utf8")); } catch { throw invalid("The Menu Planning weekly packet contains invalid JSON."); }
  const packet = validate(isRecord(decoded) && "snapshot" in decoded ? decoded.snapshot : decoded, expectedPublicationId);
  if (decodedPacketCache.size >= 32) decodedPacketCache.delete(decodedPacketCache.keys().next().value as string);
  decodedPacketCache.set(contentHash, packet);
  return packet;
}

export function decodeMenuPlanningWeekPacket(value: unknown, expectedPublicationId?: string): MenuPlanningWeekPacket {
  if (!isRecord(value)) throw invalid("The Menu Planning weekly packet is not an object.");
  if (value.encoding === "gzip+base64" || value.payloadBase64 !== undefined || isRecord(value.manifest) || isRecord(value.packet) && (value.packet.encoding === "gzip+base64" || value.packet.payloadBase64 !== undefined || value.packet.payload !== undefined)) return decodeCompressed(value, expectedPublicationId);
  return validate(isRecord(value.snapshot) ? value.snapshot : value, expectedPublicationId);
}

function toSourcePublication(packet: MenuPlanningWeekPacket): SourcePublication {
  return { publicationId: packet.publicationId, sourceWeekId: packet.sourceWeekId, weekCommencing: packet.week.weekCommencing, weekEnding: packet.week.weekEnding, days: packet.days.map(day => ({ publicationDayId: day.publicationDayId, sourceDayId: day.sourceDayId, date: day.date, dayName: day.dayName, version: day.version, status: day.status || "published", contentHash: day.contentHash || packet.contentHash || "", entries: day.entries.map(entry => ({ ...entry, allergens: safeAllergens(entry.allergens) })), allergenSignoff: {} })) };
}
export type MenuPlanningPacketPublication = ReturnType<typeof toSourcePublication>;
export const packetPublication = toSourcePublication;

async function readDirect(documentId: string) {
  const publication = await db.collection(MENU_PLANNING_PUBLICATIONS_COLLECTION).doc(documentId).get();
  recordDataAccess({ app: "delivered-in", operation: "menu-planning.publication-head.by-id", source: "FIRESTORE", dataset: MENU_PLANNING_PUBLICATIONS_COLLECTION, documents: 1, firestoreReadKind: "document" });
  if (!publication.exists) return undefined;
  const publicationData = publication.data() || {};
  if (publicationData.weekPacket) return decodeMenuPlanningWeekPacket(publicationData.weekPacket, documentId);
  const snapshotId = publication.data()?.compiledSnapshotId;
  if (typeof snapshotId !== "string") return undefined;
  const compiled = await db.collection(MENU_PLANNING_SNAPSHOTS_COLLECTION).doc(snapshotId).get();
  recordDataAccess({ app: "delivered-in", operation: "menu-planning.week-snapshot.by-id", source: "FIRESTORE", dataset: MENU_PLANNING_SNAPSHOTS_COLLECTION, documents: 1, firestoreReadKind: "document" });
  return compiled.exists ? decodeMenuPlanningWeekPacket(compiled.data(), documentId) : undefined;
}

export async function readMenuPlanningWeekPackets(fromWeek: string, toWeek: string) {
  try {
    const publications = await db.collection(MENU_PLANNING_PUBLICATIONS_COLLECTION).where("weekCommencing", ">=", fromWeek).where("weekCommencing", "<=", toWeek).limit(16).get();
    recordDataAccess({ app: "delivered-in", operation: "menu-planning.week-packets.by-window", source: "FIRESTORE", dataset: MENU_PLANNING_PUBLICATIONS_COLLECTION, documents: publications.size, firestoreReadKind: "query" });
    const packets = publications.docs.map(document => document.data()?.weekPacket).filter(Boolean);
    if (packets.length) return packets.map(packet => decodeMenuPlanningWeekPacket(packet));
  } catch { /* Absent packet collection/index retains legacy compatibility. */ }
  try {
    const snapshots = await db.collection(MENU_PLANNING_SNAPSHOTS_COLLECTION).where("week.weekCommencing", ">=", fromWeek).where("week.weekCommencing", "<=", toWeek).limit(16).get();
    recordDataAccess({ app: "delivered-in", operation: "menu-planning.week-snapshots.by-window", source: "FIRESTORE", dataset: MENU_PLANNING_SNAPSHOTS_COLLECTION, documents: snapshots.size, firestoreReadKind: "query" });
    const latest = new Map<string, MenuPlanningWeekPacket>();
    for (const document of snapshots.docs) {
      const value = decodeMenuPlanningWeekPacket(document.data());
      const current = latest.get(value.publicationId);
      if (!current || (value.publicationVersion || 0) > (current.publicationVersion || 0)) latest.set(value.publicationId, value);
    }
    return [...latest.values()];
  } catch { return []; }
}

export function packetPublicationsForRange(packets: MenuPlanningWeekPacket[], fromWeek: string, toWeek: string) {
  return packets.filter(packet => packet.week.weekCommencing >= fromWeek && packet.week.weekCommencing <= toWeek).map(toSourcePublication);
}
