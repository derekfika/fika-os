import { db } from "./firebase-admin";

export const CPU_MASTER_REVIEWS_COLLECTION = "fikaCpuMasterAllergenReviewsV1";

export type CpuMasterReview = {
  id: string;
  serviceDate: string;
  commandId: string;
  orderIds: string[];
  expectedLineages: Record<string, unknown>;
  signatureRoles: Record<string, string[]>;
  status: "pending" | "signed" | "partial";
  updatedAt: string;
  updatedBy: string;
};

const memory = new Map<string, CpuMasterReview>();
const inMemory = () => process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory";

export function cpuMasterReviewId(commandId: string) { return `cpu-master-review:${commandId}`; }

export async function saveCpuMasterReview(review: CpuMasterReview) {
  if (inMemory()) { memory.set(review.id, structuredClone(review)); return review; }
  await db.collection(CPU_MASTER_REVIEWS_COLLECTION).doc(review.id).set(review, { merge: false });
  return review;
}

export async function getCpuMasterReview(id: string) {
  if (inMemory()) return memory.get(id);
  const snapshot = await db.collection(CPU_MASTER_REVIEWS_COLLECTION).doc(id).get();
  return snapshot.exists ? snapshot.data() as CpuMasterReview : undefined;
}

export function resetCpuMasterReviewsForTests() { memory.clear(); }
