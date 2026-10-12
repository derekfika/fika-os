import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const menusRoute = readFileSync(new URL("../app/api/menus/route.ts", import.meta.url), "utf8");

test("quote generation stays on the dashboard and bounds remote persistence waits", () => {
  assert.doesNotMatch(dashboard, /window\.open\("", "_blank"\)/);
  assert.match(dashboard, /fetchQuoteRequest/);
  assert.match(dashboard, /import \{ fetchQuoteRequest \} from/);
  assert.match(dashboard, /void load\(action !== "Quoted"\)/);
  assert.match(dashboard, /Retry quote generation/);
  assert.doesNotMatch(dashboard, /Retry quote PDF save/);
});

test("menu readiness follows the current amended Production Order identity", () => {
  assert.match(dashboard, /productionOrderId=\$\{encodeURIComponent\(productionOrderId\)\}/);
  assert.match(menusRoute, /request\.nextUrl\.searchParams\.get\("productionOrderId"\)/);
  assert.match(menusRoute, /productionOrderCandidates\(booking\.canonicalId/);
  assert.match(menusRoute, /fetchCpuProductionPlan\(request/);
  assert.match(menusRoute, /cpuNotFound\(response/);
  assert.match(menusRoute, /cpuBodyErrorMessage\(body, response\.status\)/);
  assert.match(dashboard, /body\.error\?\.message \|\| body\.readiness\?\.reason/);
});

test("shared Hospitality dashboard exposes governed additional charges and stale-quote recovery", () => {
  assert.match(dashboard, /action: "set-additional-charges"/);
  assert.match(dashboard, /Manage charges/);
  assert.match(dashboard, /Additional charges subtotal/);
  assert.match(dashboard, /Labour calculator/);
  assert.match(dashboard, /Use configured rate/);
  assert.match(dashboard, /Enter a custom net rate/);
  assert.match(dashboard, /Quote needs regeneration/);
  assert.match(dashboard, /current\.stale/);
  assert.match(dashboard, /additionalCharges/);
  assert.doesNotMatch(dashboard, /window\.(?:alert|confirm|prompt)\(/);
});

test("additional-charge manager preserves unsaved edits and provides accessible responsive controls", () => {
  assert.match(dashboard, /const hasChanges = JSON\.stringify\(charges\) !== original\.current/);
  assert.match(dashboard, /Save changes/);
  assert.match(dashboard, /AdditionalChargesModal/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.match(dashboard, /document\.addEventListener\("keydown"/);
  assert.match(dashboard, /additional-charge-editor__grid/);
  assert.match(dashboard, /Use configured rate/);
  assert.match(dashboard, /1\.5×/);
  assert.match(dashboard, /2×/);
  assert.match(dashboard, /event\.target\.value === "custom" \? "1\.25"/);
  assert.match(dashboard, /Custom multiplier<input type="number" min="0\.25" max="5" step="0\.05"/);
});

test("manager document actions: quote PDF only, loading state, plain-language allergen copy, labelled format control", () => {
  // The HTML intermediate is never opened by the operator: Open quote needs the saved PDF.
  const openQuote = dashboard.slice(dashboard.indexOf("const openQuote ="), dashboard.indexOf("const generateMenu"));
  assert.doesNotMatch(openQuote, /openPrintSheet/);
  assert.match(openQuote, /current\.pdfStatus === "saved"/);
  // Inline loading state that blocks repeat activation of quote generation.
  assert.match(dashboard, /Generating quote…/);
  assert.match(dashboard, /disabled=\{quoteBusy && \(action === "Quoted" \|\| action === "QuotePdfRetry"\)\}/);
  assert.match(dashboard, /if \(quoteBusy\) return;/);
  // Allergen failure copy is operator-facing; the technical detail goes to diagnostics only.
  assert.match(dashboard, /Allergen matrix unavailable/);
  assert.match(dashboard, /couldn&apos;t load the latest CPU allergen data\. Try again\./);
  assert.doesNotMatch(dashboard, /<small>\{matrixArtifact\.error/);
  assert.match(dashboard, /console\.warn\("FIKA allergen matrix unavailable"/);
  // Menu format is a labelled native select in its own form-control wrapper, not a pseudo-card.
  assert.match(dashboard, /<label className="manager-menu-format">/);
  assert.match(dashboard, /<select\s+value=\{menuFormat\}/);
});
