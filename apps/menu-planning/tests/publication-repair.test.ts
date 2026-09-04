import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("publication repair is an explicit version-preserving outbox operation", async () => {
  const source = await readFile(join(process.cwd(), "lib", "menu-publication.ts"), "utf8");
  const route = await readFile(join(process.cwd(), "app", "api", "rolling-menu", "publications", "route.ts"), "utf8");
  assert.match(source, /repairPublishedMenuPublication/);
  assert.match(source, /menu-publication-handoff-repaired:v/);
  assert.match(source, /event\.delivery\.status === "delivered"/);
  assert.match(route, /action === "repair-handoff"/);
  assert.doesNotMatch(source, /publication\.publicationVersion\s*\+\+/);
});
