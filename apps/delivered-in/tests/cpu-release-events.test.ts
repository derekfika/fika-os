import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("CPU release event contract is bounded and packet-driven", async () => {
  const route = await readFile(new URL("../app/api/internal/cpu-release-event/route.ts", import.meta.url), "utf8");
  const event = await readFile(new URL("../lib/cpu-release-events.ts", import.meta.url), "utf8");
  const materialiser = await readFile(new URL("../lib/delivered-in-projection-materialiser.ts", import.meta.url), "utf8");
  assert.match(route, /x-fika-internal-token/);
  assert.match(event, /changedDishIds/);
  assert.match(event, /reconcileDeliveredInDay/);
  assert.match(materialiser, /CPU_PACKET_MISSING_DISH/);
  assert.match(materialiser, /CPU_REVIEW_UNSIGNED/);
  assert.match(materialiser, /review\??\.entries/);
});

test("CPU release reconciliation certifies the saved site-menu artifact before completing the receipt", async () => {
  const event = await readFile(new URL("../lib/cpu-release-events.ts", import.meta.url), "utf8");
  const artifactSaved = event.indexOf("await saveSiteMenuArtifactHosted(artifact);");
  const finalReconciliation = event.indexOf("const finalReconciled = await reconcileDeliveredInDay");
  const finalReceipt = event.lastIndexOf("const receipt = await completeCpuReleaseReceipt");
  const artifactRevoked = event.indexOf("const artifactRevoked = await revokeSiteMenuArtifactHosted");
  const invalidation = event.indexOf("const result = await invalidateDeliveredInProjection");
  assert.ok(artifactSaved >= 0 && artifactSaved < finalReconciliation);
  assert.ok(finalReconciliation < finalReceipt);
  assert.ok(artifactRevoked >= 0 && artifactRevoked < invalidation);
  assert.match(event, /DELIVERED_IN_RELEASE_NOT_COHERENT/);
  assert.match(event, /site-menu-artifact-saved/);
  assert.match(event, /final-projection-reconciliation/);
  assert.match(event, /receipt-completed/);
});
