import { db } from "./firebase-admin";
import type { ProductionPlan } from "../app/lib/production-plan";
export const cpuPlans = () => db.collection("fikaCpuProductionPlansV1");
export const cpuChanges = () => db.collection("fikaCpuProductionChangesV1");
export const cpuCursor = () => db.collection("fikaCpuProductionChangeCursorV1");
export const cpuProjections = () => db.collection("fikaCpuProductionDayProjectionsV1");
export const cpuChangeReceipts = () => db.collection("fikaCpuProductionChangeReceiptsV1");
export async function loadPlansForOrders(orderIds: string[]) {
  const wanted = [...new Set(orderIds)];
  if (!wanted.length) return [] as ProductionPlan[];
  const snapshots = await Promise.all(wanted.map(orderId => cpuPlans().doc(orderId).get()));
  return snapshots.flatMap(snapshot => snapshot.exists ? [snapshot.data() as ProductionPlan] : []);
}
export async function appendCpuChange<T extends Record<string, unknown>>(input: T) { return db.runTransaction(async transaction => { const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined; const receiptRef = idempotencyKey ? cpuChangeReceipts().doc(idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")) : undefined; const receipt = receiptRef ? await transaction.get(receiptRef) : undefined; if (receipt?.exists) return receipt.data()?.event as T & { sequence: number }; const cursorRef = cpuCursor().doc("global"); const current = await transaction.get(cursorRef); const sequence = Number(current.data()?.sequence || 0) + 1; const event = { ...input, sequence } as T & { sequence: number }; transaction.set(cursorRef, { sequence }); transaction.create(cpuChanges().doc(String(sequence).padStart(20, "0")), event); if (receiptRef) transaction.create(receiptRef, { idempotencyKey, event }); return event; }); }
