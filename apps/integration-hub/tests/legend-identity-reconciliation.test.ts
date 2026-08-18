import assert from "node:assert/strict";
import test from "node:test";
import { buildLegendIdentityQueues, classifyProviderIdentity } from "../lib/legend-identity-reconciliation";
import { mergeProviderUpdate, sameProviderIdentity } from "../lib/mapping";
import type { StagingRecord } from "../lib/schemas";
import type { CanonicalRecord } from "../lib/types";

const evidence = (record: Record<string, unknown>) => ({ displayName: record.displayName, workEmail: record.workEmail, externalIdentities: record.externalIdentities });
const lifecycle = () => "needs-review";

function legend(id: string, provider: string, externalId: string, displayName = "Alex Example"): CanonicalRecord {
  return { canonicalId: id, entityType: "Legend", dataHash: id, lifecycleStatus: "needs-review", record: { entityType: "Legend", canonicalId: id, displayName, externalIdentities: [{ provider, externalId }], version: 1, ownership: { providerOwned: {}, fikaOwned: { primarySiteId: "oploc:kept" } } } };
}

function stage(overrides: Partial<StagingRecord> = {}): StagingRecord {
  return {
    stagingId: "staging:source-person",
    importId: "sync:source",
    sourceRow: 1,
    entityType: "Legend",
    raw: { provider: "rota" },
    normalised: { displayName: "Alex Example", externalIdentities: [] },
    issues: [],
    duplicateCandidates: [],
    state: "possible-duplicate",
    mappingVersion: 1,
    ...overrides,
  };
}

function queues(staging: StagingRecord[], canonical: CanonicalRecord[], sourceMappings: Record<string, unknown>[] = []) {
  return buildLegendIdentityQueues({ staging, canonical, sourceMappings, lifecycle, evidence });
}

test("exact BrightHR identity is linked and never enters human Legend review", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const staged = stage({ normalised: { displayName: "Alex Example", externalIdentities: [{ provider: " BrightHR ", externalId: "employee:alex" }] }, duplicateCandidates: [{ canonicalId: "legend:alex", reason: "legacy exact provider match", confidence: 1 }] });
  assert.equal(classifyProviderIdentity(canonical, "Legend", "brighthr", "employee:alex").kind, "linked");
  assert.equal(queues([staged], canonical).active.length, 0);
});

test("exact provider update keeps one canonical Legend and preserves its identity and FIKA-owned fields", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const incoming = { entityType: "Legend", externalIdentities: [{ provider: "brighthr", externalId: "employee:alex" }], displayName: "Alex Updated", active: true };
  const matches = canonical.filter(record => sameProviderIdentity(record.record, incoming));
  assert.equal(matches.length, 1);
  matches[0].record = mergeProviderUpdate(matches[0].record, incoming, "person:admin");
  assert.equal(canonical.length, 1);
  assert.equal(matches[0].canonicalId, "legend:alex");
  assert.equal(matches[0].record.canonicalId, "legend:alex");
  assert.equal((matches[0].record.ownership as { fikaOwned: { primarySiteId: string } }).fikaOwned.primarySiteId, "oploc:kept");
});

test("one provider identity on multiple Legends is a blocking classification", () => {
  const canonical = [legend("legend:one", "brighthr", "employee:shared"), legend("legend:two", "brighthr", "employee:shared")];
  const result = classifyProviderIdentity(canonical, "Legend", "BrightHR", "employee:shared");
  assert.equal(result.kind, "conflict");
  assert.deepEqual(result.matches.map(record => record.canonicalId), ["legend:one", "legend:two"]);
});

test("genuinely distinct cross-source identities can enter human review", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const staged = stage({ normalised: { displayName: "Alex Example", externalIdentities: [{ provider: "rota", externalId: "rota-person:alex" }] }, duplicateCandidates: [{ canonicalId: "legend:alex", reason: "name and email evidence are similar", confidence: 0.8 }] });
  const result = queues([staged], canonical);
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].candidates[0].canonicalId, "legend:alex");
});

test("confirmed and rejected decisions remain absent after overview refresh", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const staged = stage({ duplicateCandidates: [{ canonicalId: "legend:alex", reason: "similar evidence", confidence: 0.8 }] });
  for (const mappingStatus of ["confirmed", "rejected"]) {
    const mappings = [{ sourceEntityType: "person-identity", sourceIdentifier: staged.stagingId, mappingStatus }];
    assert.equal(queues([staged], canonical, mappings).active.length, 0);
    assert.equal(queues([staged], canonical, mappings).active.length, 0);
  }
});

test("deferred decisions are separated from active reviews", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const staged = stage({ duplicateCandidates: [{ canonicalId: "legend:alex", reason: "similar evidence", confidence: 0.8 }] });
  const result = queues([staged], canonical, [{ sourceEntityType: "person-identity", sourceIdentifier: staged.stagingId, mappingStatus: "deferred" }]);
  assert.equal(result.active.length, 0);
  assert.equal(result.deferred.length, 1);
});

test("missing rota evidence is reported separately and does not create a self-comparison", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const staged = stage({ normalised: { displayName: "Alex Example", rotaSiteMappingStatus: "no-exact-rota-match", externalIdentities: [{ provider: "brighthr", externalId: "employee:alex" }] }, duplicateCandidates: [{ canonicalId: "legend:alex", reason: "legacy exact provider match", confidence: 1 }] });
  const result = queues([staged], canonical);
  assert.equal(result.active.length, 0);
  assert.equal(result.missingRotaEvidence.length, 1);
});

test("provider refresh with the same stable source ID does not recreate a resolved review", () => {
  const canonical = [legend("legend:alex", "brighthr", "employee:alex")];
  const mapping = [{ sourceEntityType: "person-identity", sourceIdentifier: "staging:source-person", mappingStatus: "confirmed" }];
  const first = stage({ duplicateCandidates: [{ canonicalId: "legend:alex", reason: "similar evidence", confidence: 0.8 }] });
  const refreshed = stage({ normalised: { displayName: "Alex Example", workEmail: "alex@example.test", externalIdentities: [] }, duplicateCandidates: [{ canonicalId: "legend:alex", reason: "similar evidence", confidence: 0.9 }] });
  assert.equal(queues([first], canonical, mapping).active.length, 0);
  assert.equal(queues([refreshed], canonical, mapping).active.length, 0);
});
