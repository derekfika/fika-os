import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOplocId, GOVERNED_OPLOCS, oplocIdsMatch, resolveGovernedOploc } from "@fika/server-shared/governed-oplocs";

test("shared governed OPLOC authority resolves Wise and rejects unknown IDs", () => {
  const wise = GOVERNED_OPLOCS.find(value => value.label === "Wise");
  assert.deepEqual(wise, { id: "oploc:4e7b2838-95de-49c8-bf04-55200841d4cb", label: "Wise" });
  assert.deepEqual(resolveGovernedOploc(wise?.id), wise);
  assert.deepEqual(resolveGovernedOploc(undefined, "Wise"), wise);
  assert.equal(resolveGovernedOploc("oploc:unknown"), undefined);
});

test("shared governed OPLOC authority preserves the historical Haleon alias", () => {
  const current = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b";
  const historical = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
  assert.equal(canonicalOplocId(historical), current);
  assert.equal(oplocIdsMatch(historical, current), true);
  assert.equal(resolveGovernedOploc("oploc:unknown", "Unknown"), undefined);
});
