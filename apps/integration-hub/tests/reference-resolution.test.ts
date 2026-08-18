import assert from "node:assert/strict";
import test from "node:test";
import { resolveStagingReferences, unresolvedRequiredReference } from "../lib/reference-resolution";
import type { CanonicalRecord } from "../lib/types";
import type { StagingRecord } from "../lib/schemas";

const canonical = (entityType: CanonicalRecord["entityType"], canonicalId: string, provider: string, externalId: string): CanonicalRecord => ({ canonicalId, entityType, dataHash: canonicalId, record: { externalIdentities: [{ provider, externalId }] } });

test("Till Item Variation resolves parent and explicit location prices to canonical IDs", () => {
  const record: StagingRecord = { stagingId: "variation:one", importId: "sync:square", sourceRow: 1, entityType: "Till Item Variation", raw: { provider: "square" }, normalised: { tillItemExternalId: "item-one", locationPrices: [{ locationExternalId: "site-one", amount: 495, currency: "GBP" }] }, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 };
  resolveStagingReferences(record, [canonical("Till Item", "till-item:one", "square", "item-one"), canonical("Site", "site:one", "square", "site-one")]);
  assert.equal(record.normalised.tillItemId, "till-item:one");
  assert.deepEqual(record.normalised.sitePrices, [{ siteId: "site:one", amountMinor: 495, currency: "GBP" }]);
});

test("BrightHR Employment staging resolves to the existing Legend identity", () => {
  const record: StagingRecord = { stagingId: "employment:one", importId: "sync:brighthr", sourceRow: 1, entityType: "Employment", raw: { provider: "brighthr" }, normalised: { legendId: "", legendExternalId: "employee:one", employmentState: "Active", startDate: "2024-02-03" }, issues: [], duplicateCandidates: [], state: "ready", mappingVersion: 1 };
  resolveStagingReferences(record, [canonical("Legend", "legend:one", "brighthr", "employee:one")]);
  assert.equal(record.normalised.legendId, "legend:one");
  assert.equal(unresolvedRequiredReference(record), "");
});
