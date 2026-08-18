import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { governanceIssues } from "../lib/data-governance";
import { planLegendReemploymentMerge } from "../lib/legend-reemployment-merge";
import { parseCanonical } from "../lib/schemas";
import type { CanonicalRecord } from "../lib/types";

const now = "2026-07-29T12:00:00.000Z";
const actor = { uid: "person:integration-admin", name: "Integration Admin" };

test("missing rota evidence is not a canonical Legend issue", () => {
  const legend = fixtureLegend("legend:rota-optional", "Provider Person", "provider-1");
  const staging = [
    {
      stagingId: "staging:rota-optional",
      importId: "sync:fixture",
      sourceRow: 1,
      entityType: "Legend" as const,
      raw: { provider: "brighthr", externalId: "provider-1" },
      normalised: {
        displayName: "Provider Person",
        rotaSiteMappingStatus: "no-exact-rota-match",
      },
      issues: [],
      duplicateCandidates: [],
      state: "ready" as const,
      mappingVersion: 1,
    },
  ];
  assert.deepEqual(governanceIssues([legend], staging), []);
});

test("approved re-employment merge preserves one Legend and separate Employment records", () => {
  const first = fixtureLegend(
    "legend:rejoin-survivor",
    "Rejoining Legend",
    "provider-old",
    "Terminated",
    "2025-05-01",
  );
  const returned = fixtureLegend(
    "legend:rejoin-returned",
    "Rejoining Legend",
    "provider-new",
    "Active",
  );
  const plan = planLegendReemploymentMerge(
    [first, returned],
    {
      survivorCanonicalId: first.canonicalId,
      memberCanonicalIds: [first.canonicalId, returned.canonicalId],
      profileSourceCanonicalId: returned.canonicalId,
    },
    actor,
    now,
  );

  assert.equal(plan.survivor.canonicalId, first.canonicalId);
  assert.equal(plan.survivor.record.externalIdentities instanceof Array, true);
  assert.equal((plan.survivor.record.externalIdentities as unknown[]).length, 2);
  assert.equal("employmentState" in plan.survivor.record, false);
  assert.equal(plan.archived[0]?.lifecycleStatus, "archived");
  assert.deepEqual(plan.archived[0]?.record.externalIdentities, []);
  assert.equal(plan.employments.length, 2);
  assert.equal(
    new Set(plan.employments.map((record) => record.canonicalId)).size,
    2,
  );
  for (const employment of plan.employments) {
    assert.equal(employment.record.legendId, first.canonicalId);
    assert.equal(parseCanonical("Employment", employment.record).success, true);
  }
  const issues = governanceIssues(
    [plan.survivor, ...plan.archived, ...plan.employments],
    [],
  );
  assert.equal(
    issues.some((issue) => issue.code === "DUPLICATE_NORMALISED_NAME"),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.code === "CONFLICTING_EXTERNAL_IDENTITY"),
    false,
  );
});

test("Legend Registry offers manual employment and working-location management", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/ui/DataRegistry.tsx"),
    "utf8",
  );
  for (const text of [
    "Add employment details",
    "Assign working location",
    "Rota suggestions:",
    "These are hints",
  ])
    assert.ok(source.includes(text), `Expected Legend profile text: ${text}`);
});

function fixtureLegend(
  canonicalId: string,
  displayName: string,
  externalId: string,
  employmentState = "Active",
  terminationDate?: string,
): CanonicalRecord {
  const identity = { provider: "brighthr", externalId, providerVersion: "" };
  const record = {
    schemaVersion: "0.1.0",
    version: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
    active: employmentState === "Active",
    externalIdentities: [identity],
    provenanceIds: ["provenance:synthetic"],
    ownership: {
      providerOwned: {
        displayName,
        employmentState,
        ...(terminationDate ? { terminationDate } : {}),
        externalIdentities: [identity],
      },
      fikaOwned: {},
    },
    entityType: "Legend" as const,
    canonicalId,
    displayName,
    employmentState,
  };
  return {
    canonicalId,
    entityType: "Legend",
    record,
    dataHash: "fixture",
    lifecycleStatus: "needs-review",
  };
}
