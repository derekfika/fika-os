import assert from "node:assert/strict";
import test from "node:test";
import { cpuReviewStatusLabel } from "../app/lib/cpu-review-status";

test("CPU review status helper renders the signed state", () => {
  assert.equal(cpuReviewStatusLabel({ cpuReview: { status: "signed", signatures: [] } }), "Signed by CPU");
  assert.equal(cpuReviewStatusLabel({ cpuReview: { status: "pending", signatures: [] } }), "Awaiting CPU sign-off");
  assert.equal(cpuReviewStatusLabel({}), "Pending CPU handoff");
});
