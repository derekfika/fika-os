import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CPU access endpoint requires session and evaluates app and OPLOC access server-side", () => {
  const source = readFileSync(new URL("../app/api/cpu-production/access/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireFikaSession/);
  assert.match(source, /appId: "cpu-production"/);
  assert.match(source, /listActiveOplocs/);
  assert.match(source, /oplocId: oploc\.id/);
  assert.match(source, /status: app\.reasonCode === "store-unavailable" \? 503 : 403/);
  assert.doesNotMatch(source, /@fikacatering\.com/);
});
