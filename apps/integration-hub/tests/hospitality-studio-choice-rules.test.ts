import assert from "node:assert/strict";
import test from "node:test";
import { validStudioGroupedAllocation } from "../../shared/hospitality-menu-studio-choice-rules";

const dishes = ["dish:a", "dish:b", "dish:c"];
const groups = [
  { id: "savory", presentation: "quantities" as const, dishIds: ["dish:a", "dish:b"] },
  { id: "sweet", presentation: "quantities" as const, dishIds: ["dish:c"] },
];

test("Hub accepts grouped per-dish quantities only when stable IDs partition published dishes", () => {
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", groups, 2,
    { "dish:a": 2, "dish:c": 3 }, 5), true);
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", groups, 2,
    { "dish:a": 2, "dish:b": 2, "dish:c": 3 }, 7), true);

  assert.equal(validStudioGroupedAllocation(dishes, "quantities", groups, 2,
    { "dish:a": 2, "dish:c": 2 }, 5), false, "dish quantities must equal the booked line quantity");
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", groups, 2,
    { "dish:a": 1, "dish:c": 2 }, 3), false, "each selected dish must meet its published minimum");
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", groups, 2,
    { "dish:a": 2, "dish:other": 2 }, 4), false, "unknown dishes are not accepted");
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", [
    { ...groups[0], dishIds: ["dish:a", "dish:b"] }, { ...groups[1], dishIds: ["dish:b", "dish:c"] },
  ], 2, { "dish:a": 2, "dish:c": 2 }, 4), false, "a dish cannot belong to multiple groups");
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", [groups[0]], 2,
    { "dish:a": 2 }, 2), false, "every published dish must belong to a group");
});

test("Hub keeps checkbox and grouped single-choice allocation unavailable", () => {
  assert.equal(validStudioGroupedAllocation(dishes, "checkboxes", undefined, 1,
    { "dish:a": 1 }, 1), false);
  assert.equal(validStudioGroupedAllocation(dishes, "dropdown", groups, 1,
    { "dish:a": 1 }, 1), false);
  assert.equal(validStudioGroupedAllocation(dishes, "checkboxes", groups, 1,
    { "dish:a": 1 }, 1), false);
  assert.equal(validStudioGroupedAllocation(dishes, "quantities", [
    { ...groups[0], presentation: "dropdown" }, groups[1],
  ], 1, { "dish:a": 1 }, 1), false);
});
