import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AUTHMOD uses the same explicit company grant control for all active person accounts", async () => {
  const source = await readFile(new URL("../app/authmod/accounts/[id]/AccountDetail.tsx", import.meta.url), "utf8");
  const control = source.split("function HospitalityAdminControl")[1]?.split("function AuthorityControl")[0];
  assert.ok(control);
  assert.match(control, /separate company-wide grant allows late amendments/);
  assert.match(control, /scope: \{ kind: "organisation", ids: \[\] \}/);
  assert.match(control, /disabled=\{!activePerson\}/);
  assert.match(control, /action: "authority-revoke", grantId: grant.id/);
  assert.match(control, /Requires an active person account/);
  assert.match(control, /does not include other sites/);
  assert.doesNotMatch(control, /<select|Assign an active OPLOC|fullAccess|Superuser/);
});
