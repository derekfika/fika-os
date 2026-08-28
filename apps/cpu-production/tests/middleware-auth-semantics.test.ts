import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CPU middleware redirects only missing sessions and exposes explicit access/service failures", () => {
  const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(source, /response\?\.status === 401/);
  assert.match(source, /publicRequestUrl\(request\)\.href/);
  assert.match(source, /CPU Production access is denied\./);
  assert.match(source, /FIKA OS authentication service is unavailable\./);
  assert.match(source, /response\?\.status === 403 \? 403 : response\?\.status === 401 \? 401 : 503/);
  assert.match(source, /NextResponse\.rewrite\(errorUrl/);
  assert.match(source, /pathname === "\/auth-error"/);
  const page = readFileSync(new URL("../app/auth-error/page.tsx", import.meta.url), "utf8");
  assert.match(page, /You don't have access to CPU Production/);
  assert.match(page, /We couldn't verify your access right now/);
  assert.match(readFileSync(new URL("../app/auth-error/AuthErrorActions.tsx", import.meta.url), "utf8"), /window\.location\.reload/);
  assert.match(page, /https:\/\/staging-os\.fikacatering\.com/);
});
