import crypto from "node:crypto";
import type { Actor } from "./auth";
import type { StagingRecord, SyncProgress, SyncRun } from "./schemas";
import type { HubState } from "./types";

export type SyncProvider = "brighthr" | "square";
export type PreparedSync = {
  mode: "fixture" | "live-local";
  status: "succeeded" | "partial";
  records: StagingRecord[];
  counts: Record<string, number>;
  sourceSnapshotReference?: string;
  sourceSnapshotHash?: string;
};

export type SyncStore = {
  getState(): Promise<HubState>;
  createRunningSyncRun(actor: Actor, provider: SyncProvider, run: SyncRun): Promise<void>;
  completeProviderSync(actor: Actor, provider: SyncProvider, runId: string, prepared: PreparedSync, correlationId: string): Promise<HubState>;
  failProviderSync(actor: Actor, provider: SyncProvider, runId: string, correlationId: string): Promise<void>;
  updateSyncProgress?(runId: string, progress: Omit<SyncProgress, "updatedAt">): Promise<void>;
};

export type ReportSyncProgress = (progress: Omit<SyncProgress, "updatedAt">) => Promise<void>;

export async function executeProviderSync(
  store: SyncStore,
  actor: Actor,
  provider: SyncProvider,
  fullReconciliation: boolean,
  prepare: (provider: SyncProvider, fullReconciliation: boolean, snapshot: HubState, runId: string, report: ReportSyncProgress) => Promise<PreparedSync>,
) {
  const runId = `sync:${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const run: SyncRun = { syncRunId: runId, provider, mode: "fixture", startedAt, status: "running", counts: {}, correlationId, progress: { phase: "Starting", message: "Preparing the read-only provider connection.", percent: 2, updatedAt: startedAt } };
  await store.createRunningSyncRun(actor, provider, run);

  try {
    // This snapshot and all provider/network/transformation work are deliberately
    // outside a Firestore transaction. No transaction object crosses this call.
    const snapshot = await store.getState();
    const report: ReportSyncProgress = async progress => { if (store.updateSyncProgress) await store.updateSyncProgress(runId, progress); };
    const prepared = await prepare(provider, fullReconciliation, snapshot, runId, report);
    await report({ phase: "Writing local staging", message: `Replacing the previous ${provider === "square" ? "Square" : "BrightHR"} staging set with ${prepared.records.length} transformed records.`, completed: prepared.records.length, total: prepared.records.length || 1, percent: 95 });
    return await store.completeProviderSync(actor, provider, runId, prepared, correlationId);
  } catch (error) {
    await store.failProviderSync(actor, provider, runId, correlationId);
    throw error;
  }
}
