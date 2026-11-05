import assert from "node:assert/strict";
import test from "node:test";
import { assessEventHubReferences } from "../lib/hub-reference-compatibility";
import { emptyHubContract } from "../lib/hub-operating-read-contract";
import { createEvent, validate } from "../lib/domain";

test("an unknown site ID stays valid domain data and is reported unresolved by Hub compatibility", () => {
  const event = createEvent({ siteId: "site:unknown" }, "person:test");

  assert.deepEqual(validate(event), []);
  assert.deepEqual(assessEventHubReferences(event, emptyHubContract()), [
    { id: "site:unknown", field: "siteId", status: "unresolved", label: "site:unknown" },
  ]);
});
