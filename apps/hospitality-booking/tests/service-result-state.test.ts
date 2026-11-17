import assert from "node:assert/strict";
import test from "node:test";
import { clearServiceResult } from "../lib/service-result-state";

test("clearing an amended booking removes only its stale CPU handoff result", () => {
  const previous = { amended: { status: "sent" }, other: { status: "failed" } };
  const updated = clearServiceResult(previous, "amended");
  assert.deepEqual(updated, { other: { status: "failed" } });
  assert.deepEqual(previous, { amended: { status: "sent" }, other: { status: "failed" } }, "the prior result snapshot is unchanged");
});

test("clearing an absent result preserves the existing result map", () => {
  const previous = { other: { status: "sent" } };
  assert.equal(clearServiceResult(previous, "amended"), previous);
});
