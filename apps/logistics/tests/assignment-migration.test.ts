import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLegacyAssignmentServiceDate } from "../lib/assignment-migration";

test("legacy assignment migration resolves matching job/load date", () => {
  assert.deepEqual(resolveLegacyAssignmentServiceDate("2026-08-24", "2026-08-24"), { serviceDate: "2026-08-24" });
});
test("legacy assignment migration reports conflicts and missing links", () => {
  assert.equal(resolveLegacyAssignmentServiceDate("2026-08-24", "2026-08-25").reason, "job/load service dates conflict");
  assert.equal(resolveLegacyAssignmentServiceDate(undefined, "2026-08-25").reason, "linked job or load service date is missing");
});
