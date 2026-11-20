import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Menu Planning admission is lightweight and rich capabilities remain opt-in", () => {
  const source = readFileSync(new URL("../app/api/menu-planning/access/route.ts", import.meta.url), "utf8");
  const admissionStart = source.indexOf('const context = createAuthModEvaluationContext(repository, principal);');
  const admissionEnd = source.indexOf('return NextResponse.json({ principal, allowed: true }', admissionStart) + 80;
  const admission = source.slice(admissionStart, admissionEnd);
  assert.match(admission, /allowed: true/);
  assert.doesNotMatch(admission, /getOplocReadPackage|resolvePermittedOplocIds|readMenuPlanningWritePermissions/);
  assert.match(source, /readMenuPlanningWritePermissions\(repository, principal, oplocs.map\(oploc => oploc.id\), context\)/);
  assert.match(source, /canManage: permissions.manageOplocIds.length > 0, canPublish: permissions.publishOplocIds.length > 0/);
  assert.match(source, /"Cache-Control": "no-store"/);
});
