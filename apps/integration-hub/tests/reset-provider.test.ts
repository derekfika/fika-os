import assert from "node:assert/strict";
import test from "node:test";
import { clearProviderData, emptyState } from "../lib/repository";
import type { CanonicalRecord, HubState } from "../lib/types";

function canonical(provider: "square" | "brighthr" | "spreadsheet", id: string): CanonicalRecord {
  return {
    canonicalId: `record:${id}`,
    entityType: provider === "square" ? "Till Item" : "Legend",
    dataHash: id,
    record: {
      entityType: provider === "square" ? "Till Item" : "Legend",
      externalIdentities: provider === "spreadsheet" ? [] : [{ provider, externalId: id }],
    },
  };
}

test("Square reset removes only Square-derived local data", () => {
  const state: HubState = emptyState();
  state.staging = [
    { stagingId: "staging:square", importId: "sync:square", sourceRow: 1, entityType: "Till Item", raw: { provider: "square", externalId: "square" }, normalised: {}, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 },
    { stagingId: "staging:bright", importId: "sync:bright", sourceRow: 1, entityType: "Legend", raw: { provider: "brighthr", externalId: "bright" }, normalised: {}, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 },
    { stagingId: "staging:sheet", importId: "import:sheet", sourceRow: 1, entityType: "Legend", raw: { filename: "synthetic.xlsx" }, normalised: {}, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 },
  ];
  state.canonical = [canonical("square", "square"), canonical("brighthr", "bright"), canonical("spreadsheet", "sheet")];
  state.syncRuns = [
    { syncRunId: "run:square", provider: "square", mode: "fixture", status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", counts: {}, correlationId: "correlation:square" },
    { syncRunId: "run:bright", provider: "brighthr", mode: "fixture", status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", counts: {}, correlationId: "correlation:bright" },
  ];
  state.manifests = [{ manifestId: "manifest:stale" } as HubState["manifests"][number]];

  const result = clearProviderData(state, "square");

  assert.deepEqual(result, { stagingRemoved: 1, canonicalRemoved: 1, syncRunsRemoved: 1 });
  assert.deepEqual(state.staging.map(record => record.stagingId), ["staging:bright", "staging:sheet"]);
  assert.deepEqual(state.canonical.map(record => record.canonicalId), ["record:bright", "record:sheet"]);
  assert.deepEqual(state.syncRuns.map(run => run.syncRunId), ["run:bright"]);
  assert.deepEqual(state.manifests, []);
});
