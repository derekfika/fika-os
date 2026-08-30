import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adaptCpuProductionWorkstreams,
  CPU_PRODUCTION_WORKSTREAM_LABELS,
} from "../../shared/production-workstreams";

test("Hub routing adapts legacy values and exposes canonical workstreams", () => {
  assert.deepEqual(adaptCpuProductionWorkstreams(["liana", "craig", "site_manager"]), {
    workstreams: ["sandwiches", "hospitality", "delivered_in"],
    unknown: [],
  });
  assert.equal(CPU_PRODUCTION_WORKSTREAM_LABELS.hospitality, "Hospitality");
  const service = readFileSync(new URL("../lib/connections-service.ts", import.meta.url), "utf8");
  assert.match(service, /workstreams/);
  assert.doesNotMatch(service, /views: Array<"liana"/);
});

test("unknown persisted workstream values are reported without being emitted", () => {
  assert.deepEqual(adaptCpuProductionWorkstreams(["future-person-value"]), {
    workstreams: [],
    unknown: ["future-person-value"],
  });
});
