import assert from "node:assert/strict";
import { test } from "node:test";
import { draftValueMatchesPersisted, portionPaxDraftKey, reconcilePortionDraft } from "../lib/portion-draft";
import { parsePaxInput } from "../lib/site-pax";

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

test("PAX draft retains clears and invalid values and distinguishes matching labels", () => {
  const site = destinations[0];
  const oneOff = { id: "oneoff:day:one-off:venue", label: site.label, oneOff: true };
  const governedKey = portionPaxDraftKey(site), oneOffKey = portionPaxDraftKey(oneOff);
  const draft = { [governedKey]: "", [oneOffKey]: "1.5", "entry:mon|site": "10" };
  assert.deepEqual(reconcilePortionDraft(draft, entries, [site, oneOff], { "governed:site": 60 }), { [governedKey]: "", [oneOffKey]: "1.5" });
  assert.deepEqual(reconcilePortionDraft(draft, entries, [site]), {}, "a removed one-off cannot recover into another identity");
  assert.deepEqual(reconcilePortionDraft({ [governedKey]: "60" }, entries, [], undefined, true), { [governedKey]: "60" }, "a site-only input survives loading the OPLOC list");
  for (const invalid of ["0", "-1", "1.5", "Infinity", "invalid", "9007199254740992"]) assert.equal(parsePaxInput(invalid), undefined);
  assert.equal(parsePaxInput(""), null);
  assert.equal(parsePaxInput("55"), 55);
});
