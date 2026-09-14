import assert from "node:assert/strict";
import test from "node:test";
import { GOVERNED_OPLOCS as sharedOplocs } from "@fika/server-shared/governed-oplocs";
import { GOVERNED_OPLOCS as menuOplocs, resolveGovernedOploc } from "../lib/fika-contracts";

test("Menu Planning uses the shared governed OPLOC contract", () => {
  assert.strictEqual(menuOplocs, sharedOplocs);
  assert.deepEqual(resolveGovernedOploc("oploc:4e7b2838-95de-49c8-bf04-55200841d4cb"), { id: "oploc:4e7b2838-95de-49c8-bf04-55200841d4cb", label: "Wise" });
});
