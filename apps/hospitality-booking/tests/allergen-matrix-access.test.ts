import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const api = readFileSync(new URL("../app/api/allergen-matrix/route.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");

test("Hospitality exposes a signed CPU matrix view when Drive materialisation is unavailable", () => {
  assert.match(api, /download=html/);
  assert.match(api, /signedMatrixAvailable/);
  assert.match(api, /viewUrlFor/);
  assert.match(dashboard, /matrixArtifact\?\.viewUrl/);
  assert.match(dashboard, /Authoritative signed CPU matrix/);
});

test("Hospitality does not let an older generating candidate mask the current matrix", () => {
  assert.match(api, /fetchCpuProductionPlan\(request, candidate/);
  assert.match(api, /cpuNotFound\(response, body\)/);
  assert.match(api, /body\.matrixStatus === "generating"/);
  assert.match(api, /body\.matrixStatus === "failed"/);
  assert.match(api, /status: "error"/);
  assert.match(dashboard, /status\?: "generating" \| "ready" \| "not_configured" \| "failed" \| "error"/);
  assert.match(dashboard, /onRefreshMatrix/);
});

test("Hospitality forwards the authenticated CPU read context and current release metadata", () => {
  const helper = readFileSync(new URL("../lib/cpu-production.ts", import.meta.url), "utf8");
  assert.match(helper, /"cookie", "x-fika-internal-token", "x-request-id"/);
  assert.match(helper, /request\.headers\.get\("accept"\)/);
  assert.match(api, /releaseId: release\.releaseId/);
  assert.match(api, /sourceContentHash: release\.sourceContentHash/);
});
