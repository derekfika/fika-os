import { db } from "./firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export type CpuReleaseReceiptResult = "processing" | "failed" | "applied" | "duplicate" | "superseded";
export type CpuReleaseReceipt = {
  deliveryId: string;
  eventId: string;
  eventType: "published" | "revoked";
  releaseId: string;
  releaseVersion: string;
  oplocId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  packetContentHash: string;
  result: CpuReleaseReceiptResult;
  projectionId?: string;
  projectionContentHash?: string;
  artifactId?: string;
  driveFileId?: string;
  failureCode?: string;
  appliedAt: string;
  updatedAt: string;
};

export type CpuReleaseEventIdentity = Pick<CpuReleaseReceipt, "deliveryId" | "eventId" | "eventType" | "releaseId" | "releaseVersion" | "oplocId" | "serviceDate" | "sourceDayId" | "sourcePublicationDayId" | "sourceVersion" | "sourceContentHash" | "packetContentHash">;
const receipts = () => db.collection("fikaDeliveredInCpuReleaseReceiptsV1");
const heads = () => db.collection("fikaDeliveredInCpuReleaseHeadsV1");
const memoryReceipts = new Map<string, CpuReleaseReceipt>();
const memoryHeads = new Map<string, CpuReleaseReceipt>();
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const inMemory = () => !hosted();
const receiptKey = (event: CpuReleaseEventIdentity) => stableDocumentId(`${event.deliveryId}:${event.oplocId}:${event.releaseId}`);
const headKey = (event: CpuReleaseEventIdentity) => stableDocumentId(`${event.oplocId}:${event.serviceDate}`);
function releaseNumber(value: string) { const match = value.match(/(?:^|[^0-9])(?:r|v)?(\d+)(?:$|[^0-9])/i); return match ? Number(match[1]) : 0; }
function isOlder(incoming: CpuReleaseEventIdentity, current: CpuReleaseReceipt) {
  if (current.eventType === "revoked" && incoming.eventType === "published" && incoming.releaseId === current.releaseId) return true;
  const next = releaseNumber(incoming.releaseVersion); const prior = releaseNumber(current.releaseVersion);
  if (next !== prior) return next < prior;
  return incoming.sourcePublicationDayId === current.sourcePublicationDayId && incoming.releaseId !== current.releaseId;
}
function base(event: CpuReleaseEventIdentity, result: CpuReleaseReceiptResult, now: string): CpuReleaseReceipt { return { ...event, result, appliedAt: now, updatedAt: now }; }

export async function beginCpuReleaseReceipt(event: CpuReleaseEventIdentity) {
  const key = receiptKey(event);
  if (inMemory()) {
    const existing = memoryReceipts.get(key);
    if (existing?.result === "applied" || existing?.result === "superseded") return existing.result === "applied" ? { status: "duplicate" as const, receipt: existing } : { status: "superseded" as const, receipt: existing };
    if (existing?.result === "processing") return { status: "processing" as const, receipt: existing };
    const current = memoryHeads.get(headKey(event));
    if (current && isOlder(event, current)) { const receipt = base(event, "superseded", new Date().toISOString()); memoryReceipts.set(key, receipt); return { status: "superseded" as const, receipt }; }
    const receipt = base(event, "processing", new Date().toISOString()); memoryReceipts.set(key, receipt); return { status: "claimed" as const, receipt };
  }
  const result = await db.runTransaction(async transaction => {
    const receiptRef = receipts().doc(key); const headRef = heads().doc(headKey(event));
    const receiptSnapshot = await transaction.get(receiptRef); const headSnapshot = await transaction.get(headRef);
    const existing = receiptSnapshot.exists ? receiptSnapshot.data() as CpuReleaseReceipt : undefined;
    if (existing?.result === "applied" || existing?.result === "superseded") return existing.result === "applied" ? { status: "duplicate" as const, receipt: existing } : { status: "superseded" as const, receipt: existing };
    if (existing?.result === "processing") return { status: "processing" as const, receipt: existing };
    const current = headSnapshot.exists ? headSnapshot.data() as CpuReleaseReceipt : undefined;
    const now = new Date().toISOString();
    if (current && isOlder(event, current)) { const receipt = base(event, "superseded", now); transaction.create(receiptRef, receipt); return { status: "superseded" as const, receipt }; }
    const receipt = base(event, "processing", now);
    if (existing?.result === "failed") transaction.set(receiptRef, receipt);
    else transaction.create(receiptRef, receipt);
    return { status: "claimed" as const, receipt };
  });
  recordDataAccess({ app: "delivered-in", operation: "cpu-release-receipt.claim", source: "FIRESTORE", documents: 2, estimatedFirestoreWrites: result.status === "claimed" ? 1 : 0, firestoreReadKind: "transaction" });
  return result;
}

export async function completeCpuReleaseReceipt(event: CpuReleaseEventIdentity, result: Omit<CpuReleaseReceipt, keyof CpuReleaseEventIdentity | "result" | "appliedAt" | "updatedAt"> & { result?: "applied" | "superseded" }) {
  const key = receiptKey(event); const now = new Date().toISOString(); const receipt = { ...base(event, result.result || "applied", now), ...result, updatedAt: now, appliedAt: now } as CpuReleaseReceipt;
  if (inMemory()) { const current = memoryHeads.get(headKey(event)); const finalReceipt = current && isOlder(event, current) ? { ...receipt, result: "superseded" as const } : receipt; memoryReceipts.set(key, finalReceipt); if (!current || !isOlder(event, current)) memoryHeads.set(headKey(event), finalReceipt); return finalReceipt; }
  let committed = receipt;
  await db.runTransaction(async transaction => {
    const receiptRef = receipts().doc(key); const headRef = heads().doc(headKey(event));
    const receiptSnapshot = await transaction.get(receiptRef); const headSnapshot = await transaction.get(headRef);
    const current = headSnapshot.exists ? headSnapshot.data() as CpuReleaseReceipt : undefined;
    const finalReceipt = current && isOlder(event, current) ? { ...receipt, result: "superseded" as const } : receipt;
    committed = finalReceipt;
    if (!receiptSnapshot.exists || receiptSnapshot.data()?.result === "processing") transaction.set(receiptRef, finalReceipt);
    if (finalReceipt.result === "superseded") return;
    transaction.set(headRef, finalReceipt);
  });
  recordDataAccess({ app: "delivered-in", operation: "cpu-release-receipt.complete", source: "FIRESTORE", documents: 2, estimatedFirestoreWrites: 2, firestoreReadKind: "transaction" });
  return committed;
}

export async function failCpuReleaseReceipt(event: CpuReleaseEventIdentity, error: unknown) {
  const key = receiptKey(event); const now = new Date().toISOString();
  const failureCode = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "CPU_RELEASE_DELIVERY_FAILED";
  if (inMemory()) {
    const existing = memoryReceipts.get(key);
    if (existing?.result === "processing") memoryReceipts.set(key, { ...existing, result: "failed", failureCode, updatedAt: now });
    return;
  }
  await db.runTransaction(async transaction => {
    const receiptRef = receipts().doc(key);
    const snapshot = await transaction.get(receiptRef);
    const existing = snapshot.exists ? snapshot.data() as CpuReleaseReceipt : undefined;
    if (existing?.result === "processing") transaction.set(receiptRef, { ...existing, result: "failed", failureCode, updatedAt: now });
  });
  recordDataAccess({ app: "delivered-in", operation: "cpu-release-receipt.fail", source: "FIRESTORE", documents: 1, estimatedFirestoreWrites: 1, firestoreReadKind: "transaction" });
}

export function resetCpuReleaseReceiptsForTests() { memoryReceipts.clear(); memoryHeads.clear(); }
