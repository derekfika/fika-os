import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { confirmAllergenReviewMap } from "../app/lib/allergen-review-state";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import { createCpuReleaseArtifacts } from "../lib/cpu-release-materialization";
import { isAdHocProductionOrder } from "../lib/ad-hoc-order";
import { sameMatrixSignatureScope, signingLineageForOrder, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";

const requestId = "adhoc-request:11111111-2222-3333-4444-555555555555";
const order = (extra: Record<string, unknown> = {}) => ({
  canonicalId: `production-order:v1:ad-hoc:${requestId}`, origin: "cpu_created" as const, sourceEntityId: requestId, serviceDate: "2026-11-17",
  requiredBy: "2026-11-17T12:00:00.000Z", version: 1, currentRevision: 1, clientName: "UAT board meeting", serviceType: "Ad-hoc · Board meeting", destinationLabel: "1 Test Street", serviceWindow: { startTime: "12:00" }, ...extra,
});
const items: PlannedMenuItem[] = [{ id: "m1", sourceLineId: "line:1", name: "Cheese sandwich platter", note: "", subItems: [{ id: "s1", name: "Cheese sandwich", quantity: 4, allergens: confirmAllergenReviewMap({ milk: "contains" }).states, note: "", evidenceStatus: "completed" }] }];

test("an Ad-Hoc order has a deterministic signing lineage bound to its request id and amendment revision", () => {
  const hash = allergenMatrixContentHash(items);
  const scope = signingLineageForOrder(order(), hash);
  assert.ok(scope);
  assert.equal(scope.sourceOrigin, "ad_hoc_production");
  assert.equal(scope.sourceBookingId, requestId);
  assert.equal(scope.sourceQuoteRevisionId, "ad-hoc-revision:1");
  assert.equal(scope.sourceDayId, undefined);
  assert.equal(scope.sourcePublicationDayId, undefined);
  assert.match(scope.sourceContentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(signingLineageForOrder(order(), hash), scope);
  const amended = signingLineageForOrder(order({ currentRevision: 2, version: 2 }), hash)!;
  assert.equal(sameMatrixSignatureScope(amended, scope), false, "an amendment changes the lineage, so earlier signatures stop matching");
  assert.notEqual(signingLineageForOrder(order({ version: 4 }), hash)!.sourceContentHash, scope.sourceContentHash, "a Hub order version bump is part of the lineage, as for Hospitality");
});

test("only stable Ad-Hoc ids are Ad-Hoc orders; other CPU-created orders still have no lineage", () => {
  assert.equal(isAdHocProductionOrder(order()), true);
  assert.equal(isAdHocProductionOrder({ canonicalId: "production-order:v1:cpu:abc", origin: "cpu_created" }), false);
  assert.equal(isAdHocProductionOrder({ canonicalId: `production-order:v1:ad-hoc:${requestId}`, origin: "hospitality_booking" }), false);
  assert.equal(signingLineageForOrder(order({ canonicalId: "production-order:v1:cpu:abc", sourceEntityId: undefined }), allergenMatrixContentHash(items)), undefined);
});

test("signed Ad-Hoc release is PDF-only: one Drive PDF, no OPLOC needed, no Delivered-In bundle or packet", async () => {
  const saved = { env: { ...process.env }, fetch: globalThis.fetch };
  Object.assign(process.env, { FIKA_RUNTIME_MODE: "staging", FIKA_PDF_RENDERER_URL: "https://renderer.test", FIKA_PDF_RENDERER_TOKEN: "t", HOSPITALITY_BOOKING_BASE_URL: "https://hospitality.test", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "{}", GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION: "cpux@fikacatering.com" });
  const calls: string[] = []; let driveBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.includes("/render/pdf")) return new Response(Buffer.from("%PDF-1.4 test"), { status: 200 });
    if (url.endsWith("/api/allergen-matrix/drive")) { driveBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ saved: { fileId: "drive-file-1", driveUrl: "https://drive.test/file/1" } }), { status: 200 }); }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const signed = (role: "production_chef" | "head_chef_site_manager") => ({ role, printedName: role, signedAt: "2026-10-24T10:00:00.000Z", actor: "Chef", attestation: "ok" });
    const plan = { id: "production-plan:x", orderId: order().canonicalId, status: "planned", menuItems: items, planningNotes: "", signatures: [signed("production_chef"), signed("head_chef_site_manager")], audit: [], updatedAt: "2026-10-24T10:00:00.000Z", updatedBy: "Chef" } as unknown as ProductionPlan;
    const result = await createCpuReleaseArtifacts(plan, order() as never, "Chef", "2026-10-24T10:00:00.000Z", new NextRequest("http://localhost/api/production-plan"), { publishPackage: false });
    assert.deepEqual(result.packetArtifacts, [], "no Delivered-In packet");
    assert.equal(result.siteArtifact.driveFileId, "drive-file-1");
    assert.equal(result.siteArtifact.driveUrl, "https://drive.test/file/1");
    assert.equal(result.masterArtifact, result.siteArtifact, "the single signed PDF is the artifact");
    assert.equal(calls.filter(url => url.endsWith("/api/allergen-matrix/drive")).length, 1, "exactly one PDF is saved");
    assert.match(String(driveBody?.name), /^AdHoc-.*Allergen-Checker\.pdf$/);
    assert.equal(driveBody?.productionOrderId, order().canonicalId);
    assert.equal(plan.siteMatrixArtifacts, undefined);
    assert.equal(plan.masterMatrixArtifact?.driveFileId, "drive-file-1");
  } finally {
    globalThis.fetch = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});
