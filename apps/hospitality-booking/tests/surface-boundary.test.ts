import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
const dashboardStyles = readFileSync(new URL("../app/ui/HospitalityDashboard.module.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("internal and client surfaces expose explicit audit markers", () => {
  assert.match(dashboard, /data-surface=\"fika-internal-operational\"/);
  assert.match(portal, /data-surface=\"client-branded-portal\"/);
  assert.match(portal, /data-client-brand=\{site\.key\}/);
});

test("client branding remains selector-scoped and dashboard aliases FIKA semantics", () => {
  for (const selector of [".site-angel-court", ".site-cfc", ".site-munich-re"]) assert.match(globals, new RegExp(selector.replace(".", "\\.")));
  assert.match(dashboardStyles, /data-surface="fika-internal-operational"/);
  assert.match(dashboardStyles, /--fika-action-primary/);
  assert.match(dashboardStyles, /--fika-focus-ring/);
});

test("touched internal controls keep focus-visible and committed progress safety", () => {
  assert.match(dashboardStyles, /button:focus-visible/);
  assert.match(dashboard, /disabled=\{scanBusy\}/);
  assert.match(dashboard, /amendmentProgress\.status !== "running"/);
  assert.doesNotMatch(dashboard, /window\.(alert|confirm|prompt)\s*\(/);
});
