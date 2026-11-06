import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AUTHMOD shows computed Superuser access and grants non-Superusers company-wide without an OPLOC picker", async () => {
  const source = await readFile(new URL("../app/authmod/accounts/[id]/AccountDetail.tsx", import.meta.url), "utf8");
  const control = source.split("function HospitalityAdminControl")[1]?.split("function AuthorityControl")[0];
  assert.ok(control);
  assert.match(control, /Included with Superuser across all FIKA Hospitality sites/);
  assert.match(control, /scope: \{ kind: "organisation", ids: \[\] \}/);
  assert.match(control, /Requires an active person account/);
  assert.match(control, /does not include other sites/);
  assert.doesNotMatch(control, /<select|Assign an active OPLOC/);
});
