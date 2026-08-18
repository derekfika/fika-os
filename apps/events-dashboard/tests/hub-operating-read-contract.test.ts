import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Events consumes governed operating references through the Hub contract", () => {
  const dashboard = fs.readFileSync(path.join(process.cwd(), "app/ui/Dashboard.tsx"), "utf8");
  const proxy = fs.readFileSync(path.join(process.cwd(), "app/api/hub-operating-read-contract/route.ts"), "utf8");
  const config = fs.readFileSync(path.join(process.cwd(), "lib/config.ts"), "utf8");
  assert.match(dashboard, /\/api\/hub-operating-read-contract/);
  assert.match(proxy, /\/api\/events-read-contract/);
  assert.doesNotMatch(config, /synthetic-north|synthetic-atrium|PRODUCTION_UNITS/);
  assert.doesNotMatch(dashboard, /firebase-admin|integrationHubCanonical/);
});

test("new Event selectors constrain area, service and equipment by OPLOC context", () => {
  const dashboard = fs.readFileSync(path.join(process.cwd(), "app/ui/Dashboard.tsx"), "utf8");
  assert.match(dashboard, /operationalAreas\.filter\(item => item\.oplocId === e\.responsibleOplocId\)/);
  assert.match(dashboard, /serviceArrangements\.filter\(item => item\.oplocId === e\.responsibleOplocId/);
  assert.match(dashboard, /equipmentAssets\.filter\(item => item\.oplocId === e\.responsibleOplocId/);
  assert.match(dashboard, /Manual selection reason/);
  assert.match(dashboard, /Historic reference:/);
  assert.match(dashboard, /role\.suggestions/);
});
