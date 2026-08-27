import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("CPU canonical production route has no direct Hub canonical authority imports", async () => {
  const source = await readFile(join(process.cwd(), "app/api/production/route.ts"), "utf8");
  for (const forbidden of ["@hub/lib/production-domain", "@hub/lib/auth", "@hub/lib/authmod", "@hub/lib/firebase-admin"]) assert.equal(source.includes(forbidden), false, `unexpected direct import: ${forbidden}`);
});

test("CPU production HTTP client forwards the canonical Hub endpoint boundary", async () => {
  const source = await readFile(join(process.cwd(), "lib/production-http-client.ts"), "utf8");
  assert.match(source, /\/api\/production/);
  assert.match(source, /request\.headers\.get\("cookie"\)/);
  assert.match(source, /cache: "no-store"/);
});

test("Hub production route owns authorization for CPU transport commands", async () => {
  const source = await readFile(join(process.cwd(), "../integration-hub/app/api/production/route.ts"), "utf8");
  assert.match(source, /requireActor\(request, \["integration-admin", "reviewer"\]\)/);
  for (const action of ["cpu-create", "update-lines", "report-allergen-discrepancy"]) assert.match(source, new RegExp(`input\\?\\.action === "${action}"`));
});
