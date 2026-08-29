import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptCpuProductionWorkstreams,
  canonicalCpuProductionWorkstream,
} from "../../shared/production-workstreams";

test("legacy CPU routing values adapt to canonical workstreams", () => {
  assert.equal(canonicalCpuProductionWorkstream("liana"), "sandwiches");
  assert.equal(canonicalCpuProductionWorkstream("craig"), "hospitality");
  assert.equal(canonicalCpuProductionWorkstream("site_manager"), "delivered_in");
  assert.deepEqual(adaptCpuProductionWorkstreams(["liana", "craig", "liana"]), {
    workstreams: ["sandwiches", "hospitality"],
    unknown: [],
  });
});

test("canonical workstream writes do not need or emit personal identifiers", () => {
  assert.deepEqual(adaptCpuProductionWorkstreams(["sandwiches", "hospitality", "delivered_in"]), {
    workstreams: ["sandwiches", "hospitality", "delivered_in"],
    unknown: [],
  });
  assert.deepEqual(adaptCpuProductionWorkstreams(["unknown-workstream"]), {
    workstreams: [],
    unknown: ["unknown-workstream"],
  });
});
