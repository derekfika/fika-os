import assert from "node:assert/strict";
import { test } from "node:test";
import { draftValueMatchesPersisted, reconcilePortionDraft } from "../lib/portion-draft";

const entries = [
  { id: "entry:mon", allocations: [{ destinationId: "site", destinationLabel: "Site", quantity: 10 }] },
  { id: "entry:tue", allocations: [] },
];
const destinations = [{ id: "site", label: "Site" }, { id: "other", label: "Other" }];

test("reconciles stale and meaningful local portion drafts", () => {
  assert.deepEqual(reconcilePortionDraft({ "entry:mon|site": "10" }, entries, destinations), {});
  assert.deepEqual(reconcilePortionDraft({ "entry:mon|site": "11" }, entries, destinations), { "entry:mon|site": "11" });
  assert.deepEqual(reconcilePortionDraft({ "entry:mon|site": "11", "entry:tue|other": "0" }, entries, destinations), { "entry:mon|site": "11" });
});

test("editing back to persisted numeric or empty state is clean", () => {
  assert.equal(draftValueMatchesPersisted("10", entries[0], destinations[0]), true);
  assert.equal(draftValueMatchesPersisted("0", entries[1], destinations[1]), true);
  assert.equal(draftValueMatchesPersisted("", entries[1], destinations[1]), true);
  assert.equal(draftValueMatchesPersisted("9", entries[0], destinations[0]), false);
});

test("draft reconciliation is isolated by entry and destination key", () => {
  assert.deepEqual(reconcilePortionDraft({ "entry:mon|site": "10", "entry:mon|other": "2" }, entries, destinations), { "entry:mon|other": "2" });
});
