import assert from "node:assert/strict";
import test from "node:test";
import { assessEventHubReferences } from "../lib/hub-reference-compatibility";
import { emptyHubContract } from "../lib/hub-operating-read-contract";
import { createEvent } from "../lib/domain";

test("historic Hub IDs remain readable without silent name remapping", () => {
  const event = createEvent({ responsibleOplocId: "oploc:old", siteId: "site:legacy" }, "person:test");
  const contract = emptyHubContract(); contract.historical = [{ canonicalId: "oploc:old", label: "Old OPLOC", lifecycleStatus: "decommissioned", entityType: "OPLOC", current: false }];
  const result = assessEventHubReferences(event, contract);
  assert.deepEqual(result.map(item => [item.id, item.status]), [["oploc:old", "historical"], ["site:legacy", "unresolved"]]);
});
