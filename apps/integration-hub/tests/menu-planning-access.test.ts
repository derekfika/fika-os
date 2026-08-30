import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Menu Planning admission is lightweight and rich capabilities remain opt-in", () => {
  const source = readFileSync(new URL("../app/api/menu-planning/access/route.ts", import.meta.url), "utf8");
  const admissionStart = source.indexOf('const context = createAuthModEvaluationContext(repository, principal);');
  const admissionEnd = source.indexOf('return NextResponse.json({ principal, allowed: true }', admissionStart) + 80;
  const admission = source.slice(admissionStart, admissionEnd);
  assert.match(admission, /allowed: true/);
  assert.doesNotMatch(admission, /listActiveOplocs|evaluateAuthority/);
  assert.match(source, /listActiveOplocs/);
  assert.match(source, /perOplocAccessMs/);
  assert.match(source, /publishAuthorityMs/);
});
