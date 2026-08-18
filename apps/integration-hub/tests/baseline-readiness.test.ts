import assert from "node:assert/strict";
import test from "node:test";
import { baselineCoverage } from "../lib/baseline-readiness";
import { emptyState } from "../lib/repository";

test("baseline coverage reports workplace evidence without treating missing evidence as complete", () => {
  const state = emptyState();
  state.staging = [
    { stagingId: "legend:one", importId: "sync:bright", sourceRow: 1, entityType: "Legend", raw: { provider: "brighthr" }, normalised: { displayName: "One", employmentState: "Active", externalIdentities: [{ provider: "brighthr", externalId: "one" }], rotaSiteReferences: [{ name: "Site One" }] }, issues: [], duplicateCandidates: [], state: "approved", mappingVersion: 1 },
    { stagingId: "legend:two", importId: "sync:bright", sourceRow: 1, entityType: "Legend", raw: { provider: "brighthr" }, normalised: { displayName: "Two", employmentState: "Active", externalIdentities: [{ provider: "brighthr", externalId: "two" }], rotaSiteReferences: [] }, issues: [], duplicateCandidates: [], state: "approved", mappingVersion: 1 },
  ];
  const legend = baselineCoverage(state).find(row => row.entityType === "Legend");
  assert.deepEqual(legend?.checks.find(check => check.label === "Workplace evidence"), { label: "Workplace evidence", met: 1, total: 2 });
});
