import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const api = readFileSync(new URL("../app/api/allergen-matrix/route.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");

test("The signed PDF is the only allergen document action in the Hospitality UI; the HTML view API is preserved", () => {
  // The underlying API (and its HTML view) remains available to other workflows.
  assert.match(api, /download=html/);
  assert.match(api, /signedMatrixAvailable/);
  assert.match(api, /viewUrlFor/);
  // The UI no longer offers any HTML checker: no viewUrl link, no local HTML blob, no "signed CPU view" wording.
  assert.doesNotMatch(dashboard, /matrixArtifact\??\.viewUrl|matrix\.viewUrl/);
  assert.doesNotMatch(dashboard, /Open local matrix|Open signed matrix|Authoritative signed CPU matrix|signed CPU view/);
  assert.doesNotMatch(dashboard, /type: "text\/html"/);
  assert.equal((dashboard.match(/Open signed allergen PDF/g) || []).length, 3);
  assert.match(dashboard, /Open Drive PDF/);
});

test("Hospitality does not let an older generating candidate mask the current matrix", () => {
  assert.match(api, /fetchCpuProductionPlan\(request, candidate/);
  assert.match(api, /cpuNotFound\(response, body\)/);
  assert.match(api, /body\.matrixStatus === "generating"/);
  assert.match(api, /body\.matrixStatus === "failed"/);
  assert.match(api, /status: "error"/);
  assert.match(dashboard, /status\?: "checking" \| "generating" \| "ready" \| "not_configured" \| "failed" \| "error"/);
  assert.match(dashboard, /onRefreshMatrix/);
});

test("Hospitality forwards the authenticated CPU read context and current release metadata", () => {
  const helper = readFileSync(new URL("../lib/cpu-production.ts", import.meta.url), "utf8");
  assert.match(helper, /"cookie", "x-fika-internal-token", "x-request-id"/);
  assert.match(helper, /request\.headers\.get\("accept"\)/);
  assert.match(api, /releaseId: release\.releaseId/);
  assert.match(api, /sourceContentHash: release\.sourceContentHash/);
});
