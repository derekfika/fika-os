import assert from "node:assert/strict";
import { test } from "node:test";
import { plannerDayToViewModel } from "../app/journey-planner/adapter";
import { buildPlannerDay } from "../lib/planner-read-model";
import type { DeliveryRun, DeliveryStop } from "../lib/types";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";

// Phase A: the presentation adapter turns the CANONICAL planner read model into the view model the
// V3 components render. These tests use real buildPlannerDay output, not preview fixtures.
const requirement = (id: string, label: string, oploc: string): FulfilmentRequirement => ({ canonicalId: `req:${id}`, entityType: "Fulfilment Requirement", schemaVersion: "0.1.0", version: 1, sourceDomain: "menu-planning", sourceEntityId: `source:${id}`, sourceVersion: 1, destinationOplocId: oploc, destinationLabelSnapshot: label, serviceDate: "2026-10-28", lines: [{ canonicalId: `line:${id}`, sourceLineId: `source-line:${id}`, displayNameSnapshot: id, quantity: 4, unit: "portion", sortOrder: 0 }], status: "ready_for_planning", createdAt: "now", createdBy: "test", updatedAt: "now", updatedBy: "test", audit: [], idempotencyKey: id });
const run = (id: string, extra: Partial<DeliveryRun> = {}): DeliveryRun => ({ canonicalId: id, serviceDate: "2026-10-28", status: "planned", orderedStopIds: [], version: 1, createdAt: "now", updatedAt: "now", audit: [], ...extra });
const stop = (id: string, runId: string, oploc: string, label: string, reqId: string, sequence: number): DeliveryStop => ({ canonicalId: id, runId, sequence, locationOplocId: oploc, locationLabelSnapshot: label, requirementRefs: [{ requirementId: reqId, sourceVersion: 1 }], movementRequestIds: [], status: "planned", createdAt: "now", updatedAt: "now", version: 1, audit: [] });
const health = { fulfilment: { available: true }, oplocs: { available: true }, enrichment: { available: true } };
const context = { dateLabel: "Wed 28 Oct 2026", user: { initials: "AL", name: "Alex Example", role: "Planner" } };

const day = () => {
  const a = requirement("a", "Site A", "oploc:a");
  const b = requirement("b", "Site B", "oploc:b");
  const c = requirement("c", "Site C", "oploc:c");
  const first = run("run:1", { vehicleId: "van1", plannedCpuDepartureTime: "08:00", plannedCpuReturnTime: "11:00", orderedStopIds: ["stop:a", "stop:b"] } as Partial<DeliveryRun>);
  const empty = run("run:2", { vehicleId: "van2", plannedCpuDepartureTime: "13:00", plannedCpuReturnTime: "15:00" } as Partial<DeliveryRun>);
  const draft = run("run:3", { status: "draft", vehicleId: "van1" } as Partial<DeliveryRun>);
  return buildPlannerDay({
    serviceDate: "2026-10-28", requirements: [a, b, c], runs: [first, empty, draft],
    stops: [{ ...stop("stop:a", "run:1", "oploc:a", "Site A", a.canonicalId, 1), plannedArrivalTime: "08:30" } as DeliveryStop, stop("stop:b", "run:1", "oploc:b", "Site B", b.canonicalId, 2)],
    movements: [], oplocs: [{ id: "oploc:a", label: "Site A" }, { id: "oploc:b", label: "Site B" }, { id: "oploc:c", label: "Site C" }], health,
  });
};

test("rows are ordered by planned departure with untimed drafts last and stable Run N titles", () => {
  const model = plannerDayToViewModel(day(), context);
  assert.deepEqual(model.runs.map((row) => [row.title, row.departure, row.return]), [["Run 1", "08:00", "11:00"], ["Run 2", "13:00", "15:00"], ["Run 3", undefined, undefined]]);
  assert.equal(model.runs[2].status, "draft");
});

test("driver workflow links use the canonical van PIN route and retain run identity and service date", () => {
  const rows = plannerDayToViewModel(day(), context).runs;
  assert.equal(rows[0].driverHref, "/mobile/van1?run=run%3A1&serviceDate=2026-10-28");
  assert.equal(rows[1].driverHref, "/mobile/van2?run=run%3A2&serviceDate=2026-10-28");
  const missingVehicle = day();
  missingVehicle.runs[0].vehicleId = undefined;
  assert.equal(plannerDayToViewModel(missingVehicle, context).runs[0].driverHref, undefined);
});

test("chips are CPU, then visits in stored order, then CPU; CPU is never a customer stop", () => {
  const row = plannerDayToViewModel(day(), context).runs[0];
  assert.deepEqual(row.chips.map((chip) => chip.kind), ["cpu-departure", "visit", "visit", "cpu-return"]);
  assert.deepEqual(row.chips.filter((chip) => chip.kind === "visit").map((chip) => chip.label), ["Site A", "Site B"]);
  assert.equal(row.stopCount, 2);
  assert.equal(row.loadCount, 2);
});

test("Delete empty run is eligible only for planning runs with no visits", () => {
  const rows = plannerDayToViewModel(day(), context).runs;
  assert.equal(rows[0].canRetire, false);
  assert.ok(rows[0].retireBlocker);
  assert.equal(rows[1].canRetire, true);
  assert.equal(rows[2].canRetire, true);
});

test("the queue keeps unassigned and assigned-but-untimed work, and drops scheduled work (existing planner queue rule)", () => {
  const queue = plannerDayToViewModel(day(), context).queue;
  assert.deepEqual(queue.map((item) => [item.destination, item.kind]), [["Site B", "delivery"], ["Site C", "delivery"]]);
});

test("a selected run yields an inspector whose CPU endpoints carry the planned times and no stop is invented", () => {
  const model = plannerDayToViewModel(day(), { ...context, selectedRunId: "run:1" });
  const inspector = model.inspector!;
  assert.deepEqual(inspector.stops.map((entry) => entry.kind), ["cpu-departure", "visit", "visit", "cpu-return"]);
  assert.equal((inspector.stops[0] as { time?: string }).time, "08:00");
  assert.equal((inspector.stops[3] as { time?: string }).time, "11:00");
  const draft = plannerDayToViewModel(day(), { ...context, selectedRunId: "run:3" }).inspector!;
  assert.equal((draft.stops[0] as { time?: string }).time, undefined);
});

test("an unknown selected run produces no inspector", () => {
  assert.equal(plannerDayToViewModel(day(), { ...context, selectedRunId: "run:nope" }).inspector, undefined);
});
