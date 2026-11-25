import assert from "node:assert/strict";
import test from "node:test";
import type { StudioPortalChoices } from "../../shared/hospitality-menu-studio-selection";
import { serializeStudioPortalChoice, supportsStudioPortalChoices, validStudioPortalAllocation } from "../lib/studio-portal-selection";

const base: StudioPortalChoices = { publicationHash: "a".repeat(64), minimumQuantity: 2, replacesChoiceGroupId: "variety", presentation: "dropdown", dishes: [
  { id: "dish:a", name: "Same name", description: "First" }, { id: "dish:b", name: "Same name", description: "Second" },
] };

test("product dropdown submits a single stable ID, quantity and publication hash", () => {
  assert.equal(supportsStudioPortalChoices(base), true);
  assert.equal(validStudioPortalAllocation(base, { "dish:a": 3 }, 3), true);
  assert.deepEqual(serializeStudioPortalChoice(base, { "dish:a": 3 }, 3), { id: "studio-published-dishes", quantities: { "dish:a": 3 }, publicationHash: "a".repeat(64), studioPresentation: "dropdown" });
  for (const choice of [{ "dish:a": 3, "dish:b": 2 }, { "unknown": 3 }, { "dish:a": 1 }, { "dish:a": 2.5 }]) assert.equal(validStudioPortalAllocation(base, choice, Object.values(choice).reduce((a, b) => a + b, 0)), false);
});

test("grouped quantities require verified complete unique IDs and checkboxes fail closed", () => {
  const grouped: StudioPortalChoices = { ...base, presentation: "quantities", groups: [
    { id: "first", name: "First", presentation: "quantities", dishIds: ["dish:a"] },
    { id: "second", name: "Second", presentation: "quantities", dishIds: ["dish:b"] },
  ] };
  assert.equal(supportsStudioPortalChoices(grouped), true);
  assert.equal(validStudioPortalAllocation(grouped, { "dish:a": 2, "dish:b": 3 }, 5), true);
  assert.equal(validStudioPortalAllocation(grouped, { "dish:a": Number.MAX_SAFE_INTEGER, "dish:b": 2 }, Number.MAX_SAFE_INTEGER + 2), false);
  assert.equal(validStudioPortalAllocation(grouped, { "dish:a": 2, "dish:outside": 3 }, 5), false);
  assert.equal(validStudioPortalAllocation({ ...grouped, groups: [
    { ...grouped.groups![0], presentation: "dropdown" }, grouped.groups![1],
  ] }, { "dish:a": 2, "dish:b": 3 }, 5), false);
  assert.equal(supportsStudioPortalChoices({ ...grouped, groups: [{ ...grouped.groups![0], dishIds: ["dish:a", "dish:a"] }] }), false);
  assert.equal(supportsStudioPortalChoices({ ...grouped, presentation: "checkboxes" }), false);
  assert.equal(supportsStudioPortalChoices({ ...base, groups: grouped.groups }), false);
});

test("legacy flat quantities keep their original marker shape", () => {
  const legacy = { ...base, presentation: undefined };
  assert.equal(supportsStudioPortalChoices(legacy), true);
  assert.deepEqual(serializeStudioPortalChoice(legacy, { "dish:a": 2 }, 2), { id: "studio-published-dishes", quantities: { "dish:a": 2 }, publicationHash: "a".repeat(64) });
});
