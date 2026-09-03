import { createHash } from "node:crypto";
import { encodeReadPackage } from "./read-package";

/**
 * Safety-critical CPU release contract.  A bundle is the immutable evidence
 * for one service day and one governed operational location (OPLOC).
 *
 * The packet is deliberately small: consumers only need menu-item names and
 * allergen names, not the full CPU plan.  The source hash is repeated in the
 * packet and manifest so a packet/PDF can never be detached from the matrix
 * revision that was signed.
 */
export const DAILY_SIGNED_OPLOC_BUNDLE_CONTRACT = "daily-signed-oploc-bundle.v1" as const;
export const DAILY_SIGNED_OPLOC_BUNDLE_SCHEMA_VERSION = 1 as const;
export const DAILY_BUNDLE_PACKET_CONTRACT = "daily-signed-oploc-allergen-packet.v1" as const;
export const DAILY_SIGNED_OPLOC_BUNDLE_DATASET = "snapshots/cpu-production/daily-signed-oploc-bundle" as const;
export const DAILY_SIGNED_OPLOC_BUNDLE_PACKAGE_CONTRACT = "daily-signed-oploc-bundle.read-package.v1" as const;
export const dailyBundleManifestKey = (serviceDate: string, oplocId: string) => `daily-signed-oploc-bundle/${encodeURIComponent(oplocId)}/${serviceDate}`;

export type DailyBundleSignatureRole = "production_chef" | "head_chef_site_manager";
export type DailyBundleSignature = {
  role: DailyBundleSignatureRole;
  printedName: string;
  signedAt: string;
  actor?: string;
  attestation?: string;
  signatureDataUrl?: string;
};
export type DailyBundleSource = {
  revision: number;
  contentHash: string;
  /** Stable CPU plan/order identity, when available. */
  id?: string;
};
export type DailyBundleOploc = { id: string; name: string };
export type DailyBundleArtifact = {
  contentHash: string;
  /** The durable Drive/object identity. A URL alone is not sufficient. */
  fileId: string;
  fileName?: string;
  objectName?: string;
  /** Stable retrieval URL for a signed PDF (Drive or local service URL). */
  url?: string;
};

export type DailyAllergenPacketItem = {
  menuItemId: string;
  menuItemName: string;
  /** Names for explicit CONTAINS cells. */
  allergenNames: string[];
  /** Names for explicit MAY_CONTAIN cells, kept separate for safety. */
  mayContainAllergenNames: string[];
  /** UNRECORDED is never represented as an empty/clear list. */
  allergenState: "clear" | "contains" | "may_contain" | "unrecorded";
};
export type DailyAllergenPacket = {
  contractVersion: typeof DAILY_BUNDLE_PACKET_CONTRACT;
  schemaVersion: 1;
  bundleId: string;
  serviceDate: string;
  oploc: DailyBundleOploc;
  source: DailyBundleSource;
  items: DailyAllergenPacketItem[];
  contentHash: string;
};

export type DailyBundleInvalidation = {
  kind: "withdrawn" | "amended";
  reason: string;
  invalidatedAt: string;
  invalidatedBy: string;
  /** Keeps the old signed bytes auditable after withdrawal/amendment. */
  priorBundleId: string;
  priorSourceRevision: number;
  priorSourceContentHash: string;
  priorPdfContentHash: string;
  priorPacketContentHash: string;
  supersededByBundleId?: string;
};

export type DailySignedOplocBundleStatus = "signed" | "published" | "withdrawn" | "amended";
export type DailySignedOplocBundle = {
  contractVersion: typeof DAILY_SIGNED_OPLOC_BUNDLE_CONTRACT;
  schemaVersion: 1;
  bundleId: string;
  serviceDate: string;
  oploc: DailyBundleOploc;
  source: DailyBundleSource;
  signatures: DailyBundleSignature[];
  /** Mandatory CPU master allergen sheet for the service day. */
  masterSheet: DailyBundleArtifact;
  /** Filtered signed PDF for this service day/OPLOC. */
  pdf: DailyBundleArtifact;
  /** Minimized packet published with the filtered PDF. */
  packet: DailyBundleArtifact & { objectName: string };
  status: DailySignedOplocBundleStatus;
  signedAt: string;
  publishedAt?: string;
  invalidation?: DailyBundleInvalidation;
  /** New revisions point to the immutable prior evidence. */
  supersedesBundleId?: string;
};

export type DailySignedOplocBundlePackage = {
  bundle: DailySignedOplocBundle;
  packet: DailyAllergenPacket;
};

export type DailyBundleInputItem = {
  menuItemId: string;
  menuItemName: string;
  allergens?: Record<string, string | undefined>;
  /** Explicit state is accepted for callers that have already reduced a row. */
  allergenState?: DailyAllergenPacketItem["allergenState"];
};

export type DailyBundleBuildInput = {
  bundleId: string;
  serviceDate: string;
  oploc: DailyBundleOploc;
  source: DailyBundleSource;
  signatures: DailyBundleSignature[];
  masterSheet: DailyBundleArtifact;
  pdf?: DailyBundleArtifact;
  packetArtifact?: Pick<DailyBundleArtifact, "fileId" | "objectName">;
  items: DailyBundleInputItem[];
  signedAt?: string;
  supersedesBundleId?: string;
};

export type DailyBundleDurableStore = {
  /** Persist packet bytes under its immutable content-addressed object name. */
  putPacket: (packet: DailyAllergenPacket, bytes: Uint8Array) => Promise<void>;
  /** Verify Drive/object bytes, not merely the result of an upload request. */
  verifyArtifact: (artifact: DailyBundleArtifact) => Promise<boolean>;
  /** This MUST be called after packet and PDF/master verification. */
  putManifest: (bundle: DailySignedOplocBundle, packet?: DailyAllergenPacket) => Promise<void>;
  /** Optional append-only tombstone sink. */
  putTombstone?: (tombstone: DailySignedOplocBundle) => Promise<void>;
};

/** Encode the one producer/consumer package format for a signed daily bundle. */
export function encodeDailySignedOplocBundlePackage(bundle: DailySignedOplocBundle, packet: DailyAllergenPacket, packageVersion: number) {
  if (packet.bundleId !== bundle.bundleId || packet.serviceDate !== bundle.serviceDate || packet.oploc.id !== bundle.oploc.id || packet.source.revision !== bundle.source.revision || packet.source.contentHash !== bundle.source.contentHash || packet.contentHash !== bundle.packet.contentHash) failure("The packet is not bound to this bundle.");
  return encodeReadPackage<DailySignedOplocBundlePackage>(DAILY_SIGNED_OPLOC_BUNDLE_DATASET, packageVersion, { bundle, packet }, packet.items.length, {
    schemaVersion: DAILY_SIGNED_OPLOC_BUNDLE_SCHEMA_VERSION,
    contractVersion: DAILY_SIGNED_OPLOC_BUNDLE_PACKAGE_CONTRACT,
    sourceVersion: `cpu-bundle-r${bundle.source.revision}-${bundle.source.contentHash}`,
    scope: `${bundle.oploc.id}:${bundle.serviceDate}`,
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HASH_RE = /^[a-f0-9]{64}$/i;
const REQUIRED_ROLES: readonly DailyBundleSignatureRole[] = ["production_chef", "head_chef_site_manager"];
const json = (value: unknown) => JSON.stringify(value);
export const dailyBundleSha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function dailyAllergenPacketBytes(packet: DailyAllergenPacket) {
  const { contentHash: _contentHash, ...unsigned } = packet;
  return Buffer.from(json(unsigned), "utf8");
}

function failure(message: string): never {
  throw Object.assign(new Error(message), { code: "DAILY_BUNDLE_INVALID", status: 422 });
}
function requireHash(value: string, field: string) { if (!HASH_RE.test(value)) failure(`${field} must be a SHA-256 hex hash.`); }
function requireDate(value: string) { if (!DATE_RE.test(value)) failure("A daily bundle requires a YYYY-MM-DD service date."); }
function requireNonEmpty(value: string, field: string) { if (!value.trim()) failure(`${field} is required.`); }

function stateForItem(item: DailyBundleInputItem): DailyAllergenPacketItem["allergenState"] {
  if (item.allergenState) return item.allergenState;
  const values = Object.values(item.allergens || {}).filter((value): value is string => typeof value === "string");
  if (!values.length) return "unrecorded";
  if (values.includes("contains")) return "contains";
  if (values.includes("may_contain")) return "may_contain";
  return "clear";
}

/** Convert a CPU matrix (including every sub-item) to the minimized packet. */
export function buildDailyAllergenPacket(input: {
  bundleId: string;
  serviceDate: string;
  oploc: DailyBundleOploc;
  source: DailyBundleSource;
  items: DailyBundleInputItem[];
}): { packet: DailyAllergenPacket; bytes: Uint8Array } {
  requireNonEmpty(input.bundleId, "bundleId");
  requireDate(input.serviceDate);
  requireNonEmpty(input.oploc.id, "oploc.id");
  requireNonEmpty(input.oploc.name, "oploc.name");
  if (!Number.isInteger(input.source.revision) || input.source.revision < 1) failure("source.revision must be a positive integer.");
  requireHash(input.source.contentHash, "source.contentHash");
  const items = input.items.map(item => {
    requireNonEmpty(item.menuItemId, "menuItemId");
    requireNonEmpty(item.menuItemName, "menuItemName");
    const contains: string[] = [];
    const mayContain: string[] = [];
    for (const [name, state] of Object.entries(item.allergens || {})) {
      if (typeof state !== "string") continue;
      if (state === "contains") contains.push(name);
      if (state === "may_contain") mayContain.push(name);
    }
    const allergenState = stateForItem(item);
    return { menuItemId: item.menuItemId, menuItemName: item.menuItemName, allergenNames: [...new Set(contains)].sort(), mayContainAllergenNames: [...new Set(mayContain)].sort(), allergenState };
  });
  const unsigned = { contractVersion: DAILY_BUNDLE_PACKET_CONTRACT, schemaVersion: 1 as const, bundleId: input.bundleId, serviceDate: input.serviceDate, oploc: input.oploc, source: input.source, items };
  const bytes = Buffer.from(json(unsigned), "utf8");
  const packet = { ...unsigned, contentHash: dailyBundleSha256(bytes) } satisfies DailyAllergenPacket;
  return { packet, bytes };
}

export function assertDailyAllergenPacket(packet: DailyAllergenPacket) {
  if (packet.contractVersion !== DAILY_BUNDLE_PACKET_CONTRACT || packet.schemaVersion !== 1) failure("Unsupported daily allergen packet contract.");
  requireDate(packet.serviceDate);
  requireNonEmpty(packet.bundleId, "bundleId");
  requireNonEmpty(packet.oploc.id, "oploc.id");
  requireNonEmpty(packet.oploc.name, "oploc.name");
  requireHash(packet.contentHash, "packet.contentHash");
  if (dailyBundleSha256(dailyAllergenPacketBytes(packet)) !== packet.contentHash) failure("The daily allergen packet failed its integrity check.");
  return packet;
}

function assertArtifact(artifact: DailyBundleArtifact | undefined, field: string) {
  if (!artifact) failure(`${field} is required; signed status is blocked.`);
  requireHash(artifact.contentHash, `${field}.contentHash`);
  requireNonEmpty(artifact.fileId, `${field}.fileId`);
}

function assertSignatures(signatures: DailyBundleSignature[]) {
  if (signatures.length < REQUIRED_ROLES.length) failure("Both required signatures are needed before signed status.");
  const roles = new Set<DailyBundleSignatureRole>();
  for (const signature of signatures) {
    if (roles.has(signature.role)) failure(`Duplicate ${signature.role} signature.`);
    roles.add(signature.role);
    requireNonEmpty(signature.printedName, `${signature.role}.printedName`);
    requireNonEmpty(signature.signedAt, `${signature.role}.signedAt`);
  }
  for (const role of REQUIRED_ROLES) if (!roles.has(role)) failure(`Missing required ${role} signature.`);
}

/** Build a signed (not yet published) bundle. Missing PDF fails closed. */
export function buildDailySignedOplocBundle(input: DailyBundleBuildInput): { bundle: DailySignedOplocBundle; packet: DailyAllergenPacket; packetBytes: Uint8Array } {
  requireNonEmpty(input.bundleId, "bundleId");
  requireDate(input.serviceDate);
  requireNonEmpty(input.oploc.id, "oploc.id");
  requireNonEmpty(input.oploc.name, "oploc.name");
  if (!Number.isInteger(input.source.revision) || input.source.revision < 1) failure("source.revision must be a positive integer.");
  requireHash(input.source.contentHash, "source.contentHash");
  assertSignatures(input.signatures);
  assertArtifact(input.masterSheet, "masterSheet");
  assertArtifact(input.pdf, "pdf");
  const built = buildDailyAllergenPacket({ bundleId: input.bundleId, serviceDate: input.serviceDate, oploc: input.oploc, source: input.source, items: input.items });
  const packetArtifact: DailyBundleArtifact & { objectName: string } = {
    contentHash: built.packet.contentHash,
    fileId: input.packetArtifact?.fileId || `object:${DAILY_SIGNED_OPLOC_BUNDLE_CONTRACT}:${built.packet.contentHash}`,
    objectName: input.packetArtifact?.objectName || `daily-signed-oploc-bundle/v1/${input.serviceDate}/${encodeURIComponent(input.oploc.id)}/${built.packet.contentHash}.json`,
  };
  return {
    packet: built.packet,
    packetBytes: built.bytes,
    bundle: {
      contractVersion: DAILY_SIGNED_OPLOC_BUNDLE_CONTRACT, schemaVersion: 1, bundleId: input.bundleId, serviceDate: input.serviceDate, oploc: input.oploc, source: input.source,
      signatures: input.signatures.map(signature => ({ ...signature })), masterSheet: { ...input.masterSheet }, pdf: { ...input.pdf! }, packet: packetArtifact, status: "signed", signedAt: input.signedAt || new Date().toISOString(),
      ...(input.supersedesBundleId ? { supersedesBundleId: input.supersedesBundleId } : {}),
    },
  };
}

/** Validate that an already-built bundle is internally consistent. */
export function assertDailySignedOplocBundle(bundle: DailySignedOplocBundle) {
  if (bundle.contractVersion !== DAILY_SIGNED_OPLOC_BUNDLE_CONTRACT || bundle.schemaVersion !== 1) failure("Unsupported daily signed OPLOC bundle contract.");
  requireDate(bundle.serviceDate);
  requireNonEmpty(bundle.bundleId, "bundleId");
  requireNonEmpty(bundle.oploc.id, "oploc.id");
  requireNonEmpty(bundle.oploc.name, "oploc.name");
  if (!Number.isInteger(bundle.source.revision) || bundle.source.revision < 1) failure("source.revision must be a positive integer.");
  requireHash(bundle.source.contentHash, "source.contentHash");
  assertSignatures(bundle.signatures);
  assertArtifact(bundle.masterSheet, "masterSheet");
  assertArtifact(bundle.pdf, "pdf");
  assertArtifact(bundle.packet, "packet");
  requireNonEmpty(bundle.packet.objectName, "packet.objectName");
  if (bundle.status === "published" && !bundle.publishedAt) failure("Published bundles require publishedAt.");
  return bundle;
}

/**
 * Publish packet and manifest with a strict publish-last order.  A manifest is
 * never written when any durable artifact is missing or hash verification
 * fails, so ordinary reads cannot observe a falsely signed release.
 */
export async function publishDailySignedOplocBundle(bundle: DailySignedOplocBundle, packet: DailyAllergenPacket, packetBytes: Uint8Array, store: DailyBundleDurableStore, publishedAt = new Date().toISOString()) {
  assertDailySignedOplocBundle(bundle);
  if (bundle.status !== "signed") failure("Only a signed bundle can be published.");
  if (packet.bundleId !== bundle.bundleId || packet.serviceDate !== bundle.serviceDate || packet.oploc.id !== bundle.oploc.id || packet.source.revision !== bundle.source.revision || packet.source.contentHash !== bundle.source.contentHash || packet.contentHash !== bundle.packet.contentHash) failure("The packet is not bound to this bundle.");
  if (dailyBundleSha256(packetBytes) !== packet.contentHash) failure("The packet bytes failed integrity verification.");
  await store.putPacket(packet, packetBytes);
  const packetVerified = await store.verifyArtifact(bundle.packet);
  const masterVerified = await store.verifyArtifact(bundle.masterSheet);
  const pdfVerified = await store.verifyArtifact(bundle.pdf);
  if (!packetVerified || !masterVerified || !pdfVerified) failure("Daily bundle publication is blocked until packet, master sheet and PDF are durably verified.");
  const published: DailySignedOplocBundle = { ...bundle, status: "published", publishedAt };
  await store.putManifest(published, packet);
  return published;
}

/** Create an append-only tombstone while retaining all prior signed hashes. */
export function createDailyBundleInvalidation(bundle: DailySignedOplocBundle, input: { kind: "withdrawn" | "amended"; reason: string; invalidatedAt?: string; invalidatedBy: string; supersededByBundleId?: string }): DailySignedOplocBundle {
  assertDailySignedOplocBundle(bundle);
  requireNonEmpty(input.reason, "invalidation.reason");
  requireNonEmpty(input.invalidatedBy, "invalidation.invalidatedBy");
  const invalidation: DailyBundleInvalidation = { kind: input.kind, reason: input.reason, invalidatedAt: input.invalidatedAt || new Date().toISOString(), invalidatedBy: input.invalidatedBy, priorBundleId: bundle.bundleId, priorSourceRevision: bundle.source.revision, priorSourceContentHash: bundle.source.contentHash, priorPdfContentHash: bundle.pdf.contentHash, priorPacketContentHash: bundle.packet.contentHash, ...(input.supersededByBundleId ? { supersededByBundleId: input.supersededByBundleId } : {}) };
  return { ...bundle, status: input.kind === "withdrawn" ? "withdrawn" : "amended", invalidation };
}

/** Persist only a tombstone; the original immutable objects remain untouched. */
export async function publishDailyBundleInvalidation(bundle: DailySignedOplocBundle, store: Pick<DailyBundleDurableStore, "putTombstone">) {
  assertDailySignedOplocBundle(bundle);
  if (!bundle.invalidation || (bundle.status !== "withdrawn" && bundle.status !== "amended")) failure("An invalidated bundle requires an invalidation lineage.");
  if (!store.putTombstone) failure("The durable store does not support bundle tombstones.");
  await store.putTombstone(bundle);
  return bundle;
}
