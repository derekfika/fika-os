import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { matrixSignatureScope, type ProductionPlan } from "../app/lib/production-plan";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import type { ProductionOrder } from "../lib/production-types";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
test.after(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  globalThis.fetch = originalFetch;
});

test("staging responses hold a previously ready Drive artifact without changing its stored evidence", async () => {
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  const order = { canonicalId: "staging-drive-readiness", version: 1, origin: "menu_planning", destinationOplocId: "oploc:site", serviceDate: "2026-09-03", requiredBy: "2026-09-03T12:00:00Z", sourceEntityId: "menu-day:1", sourcePublicationId: "publication:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 1, sourceContentHash: "a".repeat(64), lines: [{ canonicalId: "line:1", itemName: "Dish", customerQuantity: 1 }] } as unknown as ProductionOrder;
  const items = [{ id: "dish:1", sourceLineId: "line:1", name: "Dish", note: "", subItems: [{ id: "sub:1", name: "Dish", quantity: 1, allergens: { milk: "clear" }, note: "", evidenceStatus: "completed" as const }] }];
  const signature = (role: "production_chef" | "head_chef_site_manager") => ({ role, printedName: role, signedAt: "2026-09-03T09:00:00Z", actor: role, attestation: "reviewed", scope: matrixSignatureScope(order, allergenMatrixContentHash(items as never))! });
  const artifact = { id: "synthetic", bookingId: "booking", fileName: "test.pdf", createdAt: "2026-09-03T09:00:00Z", createdBy: "test", contentHash: "b".repeat(64), pdfStatus: "unavailable" as const, driveStatus: "not_configured" as const, driveUrl: "https://drive.example.test/synthetic" };
  const release = buildCpuAllergenRelease({ serviceDate: order.serviceDate!, sourceDayId: order.sourceEntityId!, sourcePublicationId: order.sourcePublicationId!, sourcePublicationDayId: order.sourcePublicationDayId!, sourceVersion: order.sourceVersion!, sourceContentHash: order.sourceContentHash!, version: 1, signedAt: "2026-09-03T09:00:00Z", signatures: [signature("production_chef"), signature("head_chef_site_manager")], items: items as never, masterArtifact: artifact, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
  const plan = { id: `production-plan:${order.canonicalId}`, orderId: order.canonicalId, status: "planned", menuItems: items, signatures: [signature("production_chef"), signature("head_chef_site_manager")], matrixArtifact: artifact, currentAllergenRelease: { ...release, status: "current", materializationStatus: "ready", packetArtifacts: [artifact] }, updatedAt: "2026-09-03T10:00:00Z", updatedBy: "test", audit: [] } as unknown as ProductionPlan;
  const repository = createProductionPlanRepository();
  await repository.save(plan, null);
  globalThis.fetch = async (input) => {
    if (String(input).includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${String(input)}`);
  };
  const { GET } = await import("../app/api/production-plan/route");
  const get = async (query: string) => {
    const response = await GET(new NextRequest(`http://localhost/api/production-plan?${query}`));
    assert.equal(response.status, 200);
    return response.json();
  };
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.FIKA_HUB_BASE_URL = "https://os.fikacatering.com";
  const before = await get(`matrixStatus=1&orderIds=${order.canonicalId}`);
  assert.equal(before.matrixStatuses[0].matrixStatus, "ready");
  assert.equal(before.matrixStatuses[0].matrixArtifact.driveUrl, artifact.driveUrl);
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://staging-os.fikacatering.com";
  const batch = await get(`matrixStatus=1&orderIds=${order.canonicalId}`);
  assert.equal(batch.matrixStatuses[0].matrixStatus, "not_configured");
  assert.equal(batch.matrixStatuses[0].matrixArtifact, undefined);
  const review = await get(`reviewStatus=1&orderIds=${order.canonicalId}`);
  assert.equal(review.reviewStatuses[0].matrixStatus, "not_configured");
  assert.equal(review.reviewStatuses[0].matrixArtifact, undefined);
  const selected = await get(`orderId=${order.canonicalId}`);
  assert.equal(selected.matrixStatus, "not_configured");
  assert.equal((await repository.get(order.canonicalId))?.matrixArtifact?.driveUrl, artifact.driveUrl, "containment does not rewrite historical evidence");
});
