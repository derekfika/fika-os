import assert from "node:assert/strict";
import test from "node:test";
import { extractBrightHrWorkLocations, normaliseBrightEmployee } from "../lib/connectors/brighthr";
import { mergeProviderUpdate, sameProviderIdentity } from "../lib/mapping";
import { activeStagingDocuments, chunkStagingRecords, emptyState } from "../lib/repository";
import type { StagingRecord } from "../lib/schemas";

function largeRecord(provider: "square" | "brighthr", id: string): StagingRecord {
  return { stagingId: `staging:${id}`, importId: `sync:${provider}`, sourceRow: 1, entityType: provider === "square" ? "Till Item" : "Legend", raw: { provider, externalId: id }, normalised: { name: `Synthetic ${id}`, providerPayload: "x".repeat(12_000) }, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 };
}

test("large provider staging is split below the safe Firestore document size", () => {
  const records = Array.from({ length: 120 }, (_, number) => largeRecord("square", `square-${number}`));
  const chunks = chunkStagingRecords(records);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flatMap(chunk => chunk.records).length, records.length);
  assert.ok(chunks.every(chunk => Buffer.byteLength(JSON.stringify({ source: chunk.source, records: chunk.records }), "utf8") <= 450_000));
});

test("chunking preserves provider boundaries", () => {
  const state = emptyState();
  state.staging = [largeRecord("square", "one"), largeRecord("brighthr", "two")];
  const chunks = chunkStagingRecords(state.staging);
  assert.deepEqual(chunks.map(chunk => chunk.source).sort(), ["brighthr", "square"]);
});

test("only the active provider generation is visible after atomic handover", () => {
  const document = (source: string, generation?: string) => ({ data: () => ({ source, generation }) });
  const selected = activeStagingDocuments(
    { stagingGenerations: { square: "generation:new" } },
    [document("square"), document("square", "generation:old"), document("square", "generation:new"), document("spreadsheet")],
  );
  assert.deepEqual(selected.map(item => item.data()), [{ source: "square", generation: "generation:new" }, { source: "spreadsheet", generation: undefined }]);
});

test("BrightHR workplace references are retained as provider evidence", () => {
  const references = extractBrightHrWorkLocations({ employment: { location: { id: "location:synthetic", name: "Synthetic House" } }, workLocations: ["Relief"] });
  assert.deepEqual(references, [{ providerLocationId: "", name: "Relief" }, { providerLocationId: "location:synthetic", name: "Synthetic House" }]);
});

test("BrightHR termination flags and dates make a Legend inactive", () => {
  const fromMetadata = normaliseBrightEmployee({ id: "employee:one", name: { givenName: "One", familyName: "Example" }, _metadata: { isTerminated: true } });
  const fromEmploymentEnd = normaliseBrightEmployee({ id: "employee:two", name: { givenName: "Two", familyName: "Example" }, employment: { end: "2026-07-01" } });
  assert.equal(fromMetadata.active, false);
  assert.equal(fromMetadata.employmentState, "Terminated");
  assert.equal(fromEmploymentEnd.active, false);
  assert.equal(fromEmploymentEnd.terminationDate, "2026-07-01");
});

test("BrightHR employment.start is preserved as Employment start-date evidence", () => {
  const employee = normaliseBrightEmployee({ id: "employee:start-date", name: { givenName: "Start", familyName: "Example" }, employment: { start: "2024-02-03" } });
  assert.equal(employee.startDate, "2024-02-03");
});

test("terminated provider update preserves FIKA enrichment and does not leak provider-only fields", () => {
  const existing = { entityType: "Legend", canonicalId: "legend:synthetic", version: 2, active: true, displayName: "Synthetic Legend", externalIdentities: [], ownership: { providerOwned: {}, fikaOwned: { primarySiteId: "site:fika-owned" } } };
  const updated = mergeProviderUpdate(existing, { employmentState: "Terminated", active: false, terminated: true, terminationDate: "2026-07-01" }, "person:synthetic-admin");
  assert.equal(updated.active, false);
  assert.equal(updated.employmentState, "Terminated");
  assert.equal("terminated" in updated, false);
  assert.deepEqual((updated.ownership as { fikaOwned: unknown }).fikaOwned, { primarySiteId: "site:fika-owned" });
  assert.equal(((updated.ownership as { providerOwned: Record<string, unknown> }).providerOwned).terminated, true);
});

test("rota workplace evidence remains FIKA-owned during a matched provider update", () => {
  const existing = { entityType: "Legend", canonicalId: "legend:synthetic", version: 1, active: true, displayName: "Synthetic Legend", externalIdentities: [], ownership: { providerOwned: {}, fikaOwned: {} } };
  const updated = mergeProviderUpdate(existing, { displayName: "Synthetic Legend", rotaSiteMappingStatus: "matched-by-name-review-required", primarySiteSuggestion: "Synthetic House", rotaSourceHash: "source-hash", rotaLatestWeek: "2026-07-13", rotaSiteReferences: [{ name: "Synthetic House", weeksObserved: 2, appearances: 4, latestWeek: "2026-07-13" }] }, "person:synthetic-admin");
  const ownership = updated.ownership as { providerOwned: Record<string, unknown>; fikaOwned: Record<string, unknown> };
  assert.equal("rotaSiteReferences" in ownership.providerOwned, false);
  assert.equal((ownership.fikaOwned.workLocationEvidence as { primarySiteSuggestion: string }).primarySiteSuggestion, "Synthetic House");
});

test("governed Registry corrections survive later provider refreshes", () => {
  const existing = { entityType: "Legend", canonicalId: "legend:synthetic", version: 3, active: true, displayName: "Correct FIKA Name", jobTitle: "Corrected Role", externalIdentities: [], ownership: { providerOwned: { displayName: "Old Provider Name" }, fikaOwned: { governedOverrides: { displayName: "Correct FIKA Name", jobTitle: "Corrected Role" } } } };
  const updated = mergeProviderUpdate(existing, { displayName: "New Provider Name", jobTitle: "New Provider Role", active: true }, "person:synthetic-admin");
  assert.equal(updated.displayName, "Correct FIKA Name");
  assert.equal(updated.jobTitle, "Corrected Role");
  assert.equal(((updated.ownership as { providerOwned: Record<string, unknown> }).providerOwned).displayName, "New Provider Name");
});

test("provider identity makes repeated canonical approval idempotent", () => {
  const existing = { externalIdentities: [{ provider: "square", externalId: "item:synthetic" }] };
  assert.equal(sameProviderIdentity(existing, { externalIdentities: [{ provider: "square", externalId: "item:synthetic" }] }), true);
  assert.equal(sameProviderIdentity(existing, { externalIdentities: [{ provider: "square", externalId: "item:other" }] }), false);
  assert.equal(sameProviderIdentity(existing, { externalIdentities: [{ provider: "brighthr", externalId: "item:synthetic" }] }), false);
});
