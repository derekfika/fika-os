import { db } from "./firebase-admin";
import { createHash } from "node:crypto";

export const CPU_MASTER_REVIEWS_COLLECTION = "fikaCpuMasterAllergenReviewsV1";

export type CpuMasterReview = {
  id: string;
  serviceDate: string;
  commandId: string;
  orderIds: string[];
  expectedLineages: Record<string, unknown>;
  semanticMatrixHash: string;
  signatureRoles: Record<string, string[]>;
  status: "pending" | "signed" | "partial";
  updatedAt: string;
  updatedBy: string;
  finalization: { state: "queued" | "running" | "completed" | "failed"; queuedAt?: string; startedAt?: string; completedAt?: string; updatedAt: string };
};

const memory = new Map<string, CpuMasterReview>();
const inMemory = () => process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory";

export type CpuMasterReviewMember = { orderId: string; sourceDayId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string; matrixContentHash?: string };

/** Stable identity for one exact service-date reviewed authority. */
export function cpuMasterReviewId(input: { serviceDate: string; members: CpuMasterReviewMember[] } | string) {
  if (typeof input === "string") return `cpu-master-review:${input}`; // legacy command-id records remain readable
  const identity = { serviceDate: input.serviceDate, members: [...input.members].sort((left, right) => left.orderId.localeCompare(right.orderId)) };
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `cpu-master-review:${hash}`;
}

export function cpuMasterReviewSemanticHash(members: CpuMasterReviewMember[]) {
  const hash = createHash("sha256").update(JSON.stringify([...members].sort((left, right) => left.orderId.localeCompare(right.orderId)).map(member => ({ orderId: member.orderId, matrixContentHash: member.matrixContentHash || null })))).digest("hex");
  return hash;
}

export async function saveCpuMasterReview(review: CpuMasterReview) {
  const replace = (current: CpuMasterReview | undefined) => {
    if (!current) return true;
    if (current.finalization.state === "completed" && review.finalization.state !== "completed") return false;
    if (current.status === "signed" && review.status !== "signed" && current.finalization.state !== "failed") return false;
    return true;
  };
  if (inMemory()) {
    const current = memory.get(review.id);
    if (replace(current)) memory.set(review.id, structuredClone(review));
    return memory.get(review.id) || review;
  }
  const ref = db.collection(CPU_MASTER_REVIEWS_COLLECTION).doc(review.id);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() as CpuMasterReview : undefined;
    if (!replace(current)) return current!;
    transaction.set(ref, review, { merge: false });
    return review;
  });
}

export async function getCpuMasterReview(id: string) {
  if (inMemory()) return memory.get(id);
  const snapshot = await db.collection(CPU_MASTER_REVIEWS_COLLECTION).doc(id).get();
  return snapshot.exists ? snapshot.data() as CpuMasterReview : undefined;
}

export function resetCpuMasterReviewsForTests() { memory.clear(); }
