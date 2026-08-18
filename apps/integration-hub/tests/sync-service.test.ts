import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "../lib/auth";
import { emptyState } from "../lib/repository";
import type { StagingRecord } from "../lib/schemas";
import { executeProviderSync, type PreparedSync, type SyncStore } from "../lib/sync-service";
import type { HubState } from "../lib/types";
import { activity } from "../lib/repository";

const actor: Actor = { uid: "person:synthetic-admin", name: "Synthetic Administrator", role: "integration-admin", synthetic: true };

function staging(provider: "brighthr" | "square" | "spreadsheet", id: string): StagingRecord {
  return { stagingId: `staging:${id}`, importId: provider === "spreadsheet" ? "import:sheet" : `sync:${id}`, sourceRow: 1, entityType: "Legend", raw: provider === "spreadsheet" ? { filename: "synthetic.csv" } : { provider, externalId: id }, normalised: { displayName: `Synthetic ${id}` }, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 };
}

class MemoryStore implements SyncStore {
  state: HubState;
  transactionOpen = false;
  updateCount = 0;
  progressUpdates: { phase: string; percent?: number }[] = [];
  constructor(state: HubState = emptyState()) { this.state = structuredClone(state); }
  async getState() { return structuredClone(this.state); }
  private async updateState(mutator: (state: HubState) => void) {
    assert.equal(this.transactionOpen, false, "transactions must never overlap");
    this.transactionOpen = true;
    this.updateCount += 1;
    const next = structuredClone(this.state);
    const result = mutator(next);
    assert.equal(result, undefined, "transaction mutators must be synchronous");
    this.state = next;
    this.transactionOpen = false;
    return structuredClone(this.state);
  }
  async createRunningSyncRun(runActor: Actor, provider: "brighthr" | "square", run: HubState["syncRuns"][number]) {
    await this.updateState(state => {
      state.syncRuns.push(run);
      state.activity.push(activity(runActor, "Sync started", run.syncRunId, provider, "started", run.correlationId));
    });
  }
  async completeProviderSync(runActor: Actor, provider: "brighthr" | "square", runId: string, result: PreparedSync, correlationId: string) {
    return this.updateState(state => {
      state.staging = [...state.staging.filter(record => String(record.raw.provider || "") !== provider), ...result.records];
      const run = state.syncRuns.find(candidate => candidate.syncRunId === runId);
      if (!run) throw new Error("Running SyncRun could not be found.");
      const finishedAt = new Date().toISOString();
      Object.assign(run, { mode: result.mode, status: result.status, counts: result.counts, finishedAt, progress: { phase: "Complete", message: `${result.records.length} records staged for review.`, completed: result.records.length, total: result.records.length || 1, percent: 100, updatedAt: finishedAt } });
      state.activity.push(activity(runActor, "Sync finished", runId, provider, "finished", correlationId));
    });
  }
  async failProviderSync(runActor: Actor, provider: "brighthr" | "square", runId: string, correlationId: string) {
    await this.updateState(state => {
      const run = state.syncRuns.find(candidate => candidate.syncRunId === runId);
      if (run) Object.assign(run, { status: "failed", finishedAt: new Date().toISOString(), message: "Connector failed safely; inspect local configuration." });
      state.activity.push(activity(runActor, "Sync failed", runId, provider, "failed", correlationId));
    });
  }
  async updateSyncProgress(runId: string, progress: { phase: string; message: string; percent?: number }) {
    assert.equal(this.transactionOpen, false);
    this.progressUpdates.push({ phase: progress.phase, percent: progress.percent });
    const run = this.state.syncRuns.find(candidate => candidate.syncRunId === runId);
    if (run) run.progress = { ...progress, updatedAt: new Date().toISOString() };
  }
}

function prepared(provider: "brighthr" | "square", id: string): PreparedSync {
  return { mode: "fixture", status: "succeeded", records: [staging(provider, id)], counts: { staged: 1, ready: 1, invalid: 0, duplicates: 0 } };
}

test("slow provider work runs after the running SyncRun transaction closes", async () => {
  const store = new MemoryStore();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const running = executeProviderSync(store, actor, "brighthr", false, async () => {
    assert.equal(store.transactionOpen, false);
    await wait;
    assert.equal(store.transactionOpen, false);
    return prepared("brighthr", "slow");
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(store.updateCount, 1);
  assert.equal(store.state.syncRuns[0].status, "running");
  release();
  await running;
  assert.equal(store.updateCount, 2);
  assert.equal(store.state.syncRuns[0].status, "succeeded");
});

test("failed provider request is recorded using a fresh transaction", async () => {
  const store = new MemoryStore();
  await assert.rejects(() => executeProviderSync(store, actor, "square", true, async () => {
    assert.equal(store.transactionOpen, false);
    throw new Error("synthetic provider failure");
  }), /synthetic provider failure/);
  assert.equal(store.updateCount, 2);
  assert.equal(store.state.syncRuns[0].status, "failed");
  assert.match(store.state.syncRuns[0].message || "", /failed safely/i);
  assert.equal(store.state.activity.at(-1)?.action, "Sync failed");
});

test("repeated sync replaces only the same provider staging records", async () => {
  const initial = emptyState();
  initial.staging = [staging("spreadsheet", "sheet-row"), staging("square", "square-old"), staging("brighthr", "bright-old")];
  const store = new MemoryStore(initial);
  await executeProviderSync(store, actor, "square", false, async () => prepared("square", "square-current"));
  await executeProviderSync(store, actor, "square", false, async () => prepared("square", "square-current"));
  assert.deepEqual(store.state.staging.map(record => record.stagingId).sort(), ["staging:bright-old", "staging:sheet-row", "staging:square-current"]);
  assert.equal(store.state.syncRuns.filter(run => run.provider === "square").length, 2);
  assert.equal(store.state.syncRuns.every(run => run.status === "succeeded"), true);
});

test("provider progress is reported outside transactions and completes at 100 percent", async () => {
  const store = new MemoryStore();
  await executeProviderSync(store, actor, "square", false, async (_provider, _full, _snapshot, _runId, report) => {
    await report({ phase: "Retrieving catalogue", message: "Two pages received.", completed: 200 });
    await report({ phase: "Transforming catalogue", message: "Building records.", completed: 200, total: 200, percent: 82 });
    return prepared("square", "progress");
  });
  assert.deepEqual(store.progressUpdates.map(update => update.phase), ["Retrieving catalogue", "Transforming catalogue", "Writing local staging"]);
  assert.equal(store.state.syncRuns[0].progress?.percent, 100);
  assert.equal(store.state.syncRuns[0].progress?.phase, "Complete");
});
