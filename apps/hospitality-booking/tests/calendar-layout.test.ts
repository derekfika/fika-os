import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");

test("hospitality dashboard keeps the weekly heads-up calendar permanently above the queue", () => {
  assert.doesNotMatch(source, /useState<"list" \| "calendar">/);
  const calendar = source.indexOf("<CalendarView");
  const controls = source.indexOf('className="hospitality-dashboard__controls"');
  assert.ok(calendar >= 0 && controls > calendar);
});

test("weekly cards expose the scan-first operational details", () => {
  assert.match(source, /booking\.service\.guestCount/);
  assert.match(source, /booking\.order\.eventType/);
  assert.match(source, /booking\.lifecycleStatus/);
  assert.match(source, /dietary note/);
});

test("run sheets are generated from one global date-range action", () => {
  assert.match(source, /Choose a date range/);
  assert.match(source, /Generate run sheet PDF/);
  assert.match(source, /runSheetFrom/);
  assert.doesNotMatch(source, /onRunSheet=\{/);
  assert.doesNotMatch(source, /Daily run sheet/);
});

test("generated documents open with deliberate save and share actions", () => {
  assert.match(source, /Download document/);
  assert.match(source, /Save as PDF/);
  assert.match(source, /navigator\.share/);
  assert.doesNotMatch(source, /popup\.print\(\)/);
});
