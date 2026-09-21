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
