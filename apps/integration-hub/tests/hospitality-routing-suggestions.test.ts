import assert from "node:assert/strict";
import test from "node:test";
import { suggestHospitalityMenuRouting } from "../lib/hospitality-routing-suggestions";

test("routing suggestions use an exact retained provider source ID", () => {
  const suggestion = suggestHospitalityMenuRouting([{ provider: "MNK", sourceItemId: "cookie_box" }]);
  assert.deepEqual(suggestion.workstreams, ["hospitality"]);
  assert.equal(suggestion.confidence, "medium");
  assert.match(suggestion.reason, /cookie_box/);
});

test("routing suggestions do not classify from display names", () => {
  const suggestion = suggestHospitalityMenuRouting([{ provider: "MNK", sourceItemId: "unknown" , name: "Cookie Box" }]);
  assert.deepEqual(suggestion.workstreams, []);
  assert.equal(suggestion.confidence, "none");
  assert.match(suggestion.reason, /item name was not used/);
});

test("conflicting exact provider IDs return no automatic suggestion", () => {
  const suggestion = suggestHospitalityMenuRouting([
    { sourceItemId: "cookie_box" },
    { sourceItemId: "deli-style-sandwich" },
  ]);
  assert.deepEqual(suggestion.workstreams, []);
  assert.equal(suggestion.confidence, "none");
  assert.match(suggestion.reason, /conflicting/);
});
