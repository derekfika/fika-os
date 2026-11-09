import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allergenPageState } from "../app/allergens/allergen-page-state";
import { materializationPollDelay, materializationPollingExpired, materializationPollWait, MATERIALIZATION_POLL_MAX_DURATION_MS } from "../app/allergens/materialization-polling";

const base = { date: "2027-01-04", projectionLoading: false, matrixLoading: false, projectionError: "", matrixError: "", orderCount: 0 };

test("allergen page distinguishes loading from a genuine empty result", () => {
  assert.equal(allergenPageState({ ...base, date: "", projectionLoading: true }), "loading");
  assert.equal(allergenPageState({ ...base, projectionLoading: true }), "loading");
  assert.equal(allergenPageState({ ...base, matrixLoading: true }), "loading");
  assert.equal(allergenPageState(base), "empty");
});

test("allergen page distinguishes projection and matrix failures from empty data", () => {
  assert.equal(allergenPageState({ ...base, projectionError: "network" }), "error");
  assert.equal(allergenPageState({ ...base, matrixError: "network" }), "error");
});

test("allergen page is ready only when data is loaded and non-empty", () => {
  assert.equal(allergenPageState({ ...base, orderCount: 1 }), "ready");
});

test("materialization status polling backs off and has a strict two-minute deadline", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 100].map(materializationPollDelay), [2_500, 5_000, 10_000, 15_000, 15_000, 15_000]);
  assert.equal(MATERIALIZATION_POLL_MAX_DURATION_MS, 120_000);
  assert.equal(materializationPollingExpired(1_000, 120_999), false);
  assert.equal(materializationPollingExpired(1_000, 121_000), true);
  assert.equal(materializationPollWait(3, 1_000, 119_000), 2_000);
  assert.equal(materializationPollWait(3, 1_000, 121_000), 0);
});

test("materialization polling pauses when hidden and tells operators how to continue", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(page, /visibilitychange/);
  assert.match(page, /document\.visibilityState === "hidden"/);
  assert.match(page, /materializationPollingExpired\(startedAt\)/);
  assert.match(page, /Automatic status checks stopped after two minutes/);
  assert.match(page, /Select Retry to recheck the current release lineage/);
});
