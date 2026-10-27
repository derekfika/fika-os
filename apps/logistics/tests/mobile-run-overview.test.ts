import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeliveryStop } from "../lib/types";
import { groupRunVisits, nextRunVisit, visitLaneCounts, visitProgress } from "../app/mobile/run-overview-model";

const stop = (canonicalId: string, overrides: Partial<DeliveryStop> = {}) => ({ canonicalId, status: "planned", movementType: "delivery", ...overrides }) as unknown as DeliveryStop;

test("run overview keeps the dispatcher's saved visiting order and groups mixed visits into one stop", () => {
  const visits = groupRunVisits([
    stop("d-1", { visitId: "v-1" }),
    stop("c-1", { visitId: "v-1", movementType: "collection" }),
    stop("d-2"),
    stop("d-3", { visitId: "v-3" }),
  ]);
  assert.deepEqual(visits.map((visit) => visit.key), ["v-1", "d-2", "v-3"]);
  assert.deepEqual(visits.map((visit) => visit.visitNumber), [1, 2, 3]);
  assert.deepEqual(visits[0].stops.map((item) => item.canonicalId), ["d-1", "c-1"]);
});

test("visit status follows open issues, completion, arrival and planned work in that precedence", () => {
  const [attention, completed, current, planned] = groupRunVisits([
    stop("a", { status: "completed", issues: [{ status: "open" }] as DeliveryStop["issues"] }),
    stop("b", { status: "completed" }),
    stop("c", { status: "arrived" }),
    stop("d"),
  ]);
  assert.equal(attention.status, "attention");
  assert.equal(completed.status, "completed");
  assert.equal(current.status, "current");
  assert.equal(planned.status, "planned");
});

test("progress, lane counts and next visit are computed from real stops only", () => {
  const visits = groupRunVisits([
    stop("d-1", { status: "completed", visitId: "v-1" }),
    stop("c-1", { status: "completed", visitId: "v-1", movementType: "collection" }),
    stop("d-2", { status: "arrived" }),
    stop("d-3", { issues: [{ status: "open" }] as DeliveryStop["issues"] }),
  ]);
  assert.deepEqual(visitProgress(visits), { completed: 1, total: 3, percent: 33 });
  assert.deepEqual(visitLaneCounts(visits), { deliveries: 3, collections: 1, attention: 1 });
  assert.equal(nextRunVisit(visits)?.key, "d-2");
});

test("an empty run has no progress and no next stop", () => {
  const visits = groupRunVisits([]);
  assert.deepEqual(visitProgress(visits), { completed: 0, total: 0, percent: 0 });
  assert.equal(nextRunVisit(visits), undefined);
});
