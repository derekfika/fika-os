import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { confirmAllergenReviewMap } from "../app/lib/allergen-review-state";
import { allergenMatrixContentHash, buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { createCpuReleaseArtifacts, materializeCommittedCpuRelease } from "../lib/cpu-release-materialization";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import { isAdHocProductionOrder } from "../lib/ad-hoc-order";
import { currentAllergenReleaseMatchesOrder, sameMatrixSignatureScope, signingLineageForOrder, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";

const requestId = "adhoc-request:11111111-2222-3333-4444-555555555555";
const order = (extra: Record<string, unknown> = {}) => ({
  canonicalId: `production-order:v1:ad-hoc:${requestId}`, origin: "cpu_created" as const, sourceEntityId: requestId, serviceDate: "2026-11-17",
  requiredBy: "2026-11-17T12:00:00.000Z", version: 1, currentRevision: 1, clientName: "UAT board meeting", serviceType: "Ad-hoc · Board meeting", destinationLabel: "1 Test Street", serviceWindow: { startTime: "12:00" }, ...extra,
});

test("committed Ad-Hoc materialization is repeat-safe and rechecks amendments/cancellation after upload", async () => {
  const saved = { env: { ...process.env }, fetch: globalThis.fetch };
  Object.assign(process.env, { FIKA_CPU_PLAN_STORE: "memory", FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com", FIKA_PDF_RENDERER_URL: "https://renderer.test", FIKA_PDF_RENDERER_TOKEN: "test", HOSPITALITY_BOOKING_BASE_URL: "https://hospitality.test", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "{}", GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION: "test-chef@example.test" });
  try {
    for (const scenario of ["ready", "lifecycle", "amended", "cancelled", "matrix-edit"] as const) {
      const sourceId = `${requestId}:${scenario}`;
      const canonicalId = `production-order:v1:ad-hoc:${sourceId}`;
      const canonical = order({ canonicalId, sourceEntityId: sourceId, status: "planned" });
      const scope = signingLineageForOrder(canonical, allergenMatrixContentHash(items))!;
      const signatures = (["production_chef", "head_chef_site_manager"] as const).map(role => ({ role, printedName: role, signedAt: "2026-11-01T10:00:00.000Z", actor: `test:${role}`, attestation: "I reviewed this matrix.", scope }));
      const release = buildCpuAllergenRelease({ ...scope, version: 1, signedAt: signatures[1].signedAt, signatures, items, masterArtifact: { id: "pending", bookingId: sourceId, fileName: "pending.pdf", createdAt: signatures[1].signedAt, createdBy: "test-chef", contentHash: "a".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" }, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
      const plan: ProductionPlan = { id: `production-plan:${canonicalId}`, orderId: canonicalId, status: "planned", menuItems: structuredClone(items), planningNotes: "", signatures, signedMenuContentHash: scope.matrixContentHash, currentAllergenRelease: release, audit: [], updatedAt: signatures[1].signedAt, updatedBy: "test-chef" };
      const repository = createProductionPlanRepository();
      await repository.save(plan, null);
      let uploaded = false, renderCount = 0, driveCount = 0, sourceReads = 0;
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/production?canonicalId=")) {
          sourceReads++;
          const changed = uploaded && scenario !== "ready" && scenario !== "matrix-edit";
          return new Response(JSON.stringify({ order: changed ? { ...canonical, currentRevision: scenario === "lifecycle" ? 1 : 2, version: 2, ...(scenario === "cancelled" ? { status: "cancelled" } : scenario === "lifecycle" ? { status: "complete" } : {}) } : canonical }), { status: 200 });
        }
        if (url.includes("/render/pdf")) { renderCount++; return new Response(Buffer.from("%PDF-1.4 inert test"), { status: 200 }); }
        if (url.endsWith("/api/allergen-matrix/drive")) {
          uploaded = true; driveCount++;
          if (scenario === "matrix-edit") {
            const current = (await repository.get(canonicalId))!;
            const edited = structuredClone(current);
            edited.allergenReleaseHistory = [revokeCpuAllergenRelease(edited.currentAllergenRelease!, { at: "2026-11-01T10:01:00.000Z", by: "test-chef", reason: "Material row edit" })];
            delete edited.currentAllergenRelease;
            delete edited.signatures;
            delete edited.signedMenuContentHash;
            edited.menuItems[0].subItems[0].allergens.eggs = "contains";
            await repository.save(edited, current.updatedAt);
          }
          return new Response(JSON.stringify({ saved: { fileId: `inert-${scenario}`, driveUrl: `https://drive.google.com/file/d/inert-${scenario}/view` } }), { status: 200 });
        }
        throw new Error(`Unexpected downstream publication: ${url}`);
      }) as typeof fetch;
      const request = new NextRequest("http://localhost/api/internal/cpu-release-materialize");
      if (scenario === "ready" || scenario === "lifecycle") {
        await materializeCommittedCpuRelease(request, canonicalId, release.releaseId);
        const retry = await materializeCommittedCpuRelease(request, canonicalId, release.releaseId);
        assert.equal(retry.alreadyMaterialized, true);
        assert.equal(currentAllergenReleaseMatchesOrder(retry.plan.currentAllergenRelease, canonical, items), true);
        assert.deepEqual(retry.plan.currentAllergenRelease?.packetArtifacts, []);
      } else if (scenario === "matrix-edit") {
        await assert.rejects(() => materializeCommittedCpuRelease(request, canonicalId, release.releaseId), { code: "CPU_ALLERGEN_REVIEW_CONFLICT" });
        const edited = (await repository.get(canonicalId))!;
        assert.equal(edited.currentAllergenRelease, undefined, "a failed upload phase cannot resurrect the revoked release");
        assert.equal(edited.allergenReleaseHistory?.[0].status, "revoked");
      } else {
        await assert.rejects(() => materializeCommittedCpuRelease(request, canonicalId, release.releaseId), { code: "CPU_RELEASE_LINEAGE_CONFLICT" });
        const failed = (await repository.get(canonicalId))!;
        assert.equal(failed.currentAllergenRelease?.materializationStatus, "failed");
        assert.equal(currentAllergenReleaseMatchesOrder(failed.currentAllergenRelease, canonical, items), false);
      }
      if (scenario !== "matrix-edit") assert.ok(sourceReads >= 2, "canonical source is rechecked after the external upload");
      assert.equal(renderCount, 1);
      assert.equal(driveCount, 1);
    }
  } finally {
    globalThis.fetch = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
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
  assert.deepEqual(signingLineageForOrder(order({ version: 4, status: "complete" }), hash), scope, "lifecycle-only version bumps preserve the signed demand revision");
  assert.notEqual(signingLineageForOrder(order({ sourceVersion: 4 }), hash)!.sourceContentHash, scope.sourceContentHash, "a new requester version changes source lineage");
  assert.equal(signingLineageForOrder(order({ status: "cancelled" }), hash), undefined, "cancelled demand has no signing authority");
});

test("only stable Ad-Hoc ids are Ad-Hoc orders; other CPU-created orders still have no lineage", () => {
  assert.equal(isAdHocProductionOrder(order()), true);
  assert.equal(isAdHocProductionOrder({ canonicalId: "production-order:v1:cpu:abc", origin: "cpu_created" }), false);
  assert.equal(isAdHocProductionOrder({ canonicalId: `production-order:v1:ad-hoc:${requestId}`, origin: "hospitality_booking" }), false);
  assert.equal(signingLineageForOrder(order({ canonicalId: "production-order:v1:cpu:abc", sourceEntityId: undefined }), allergenMatrixContentHash(items)), undefined);
  assert.equal(isAdHocProductionOrder({ canonicalId: "production-order:v1:ad-hoc:", origin: "cpu_created" }), false);
  assert.equal(signingLineageForOrder(order({ sourceEntityId: "another-request" }), allergenMatrixContentHash(items)), undefined, "a mismatching canonical request identity fails closed");
  assert.equal(signingLineageForOrder(order({ currentRevision: -1 }), allergenMatrixContentHash(items)), undefined);
  assert.equal(signingLineageForOrder(order({ currentRevision: 0, sourceVersion: 2 }), allergenMatrixContentHash(items)), undefined);
  assert.equal(signingLineageForOrder(order({ sourceVersion: -1 }), allergenMatrixContentHash(items)), undefined);
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
    const scope = signingLineageForOrder(order(), allergenMatrixContentHash(items))!;
    const signed = (role: "production_chef" | "head_chef_site_manager") => ({ role, printedName: role, signedAt: "2026-10-24T10:00:00.000Z", actor: "test-chef", attestation: "reviewed", scope });
    const plan = { id: "production-plan:x", orderId: order().canonicalId, status: "planned", menuItems: items, planningNotes: "", signatures: [signed("production_chef"), signed("head_chef_site_manager")], audit: [], updatedAt: "2026-10-24T10:00:00.000Z", updatedBy: "Chef" } as unknown as ProductionPlan;
    plan.signedMenuContentHash = scope.matrixContentHash;
    plan.currentAllergenRelease = buildCpuAllergenRelease({ ...scope, version: 1, signedAt: plan.updatedAt, signatures: plan.signatures!, items, masterArtifact: { id: "pending", bookingId: requestId, fileName: "pending.pdf", createdAt: plan.updatedAt, createdBy: "test-chef", contentHash: "a".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" }, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
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
    await result.publish();
    const retry = await createCpuReleaseArtifacts(plan, order() as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan"));
    assert.equal(retry.masterArtifact.driveFileId, result.masterArtifact.driveFileId);
    assert.equal(calls.length, 2, "replay reuses the exact release PDF without renderer, Drive or package writes");
    const atSite = await createCpuReleaseArtifacts(plan, order({ destinationOplocId: "oploc:test" }) as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan"));
    assert.deepEqual(atSite.packetArtifacts, [], "an Ad-Hoc order at a governed site still creates no Delivered-In packet");
    await assert.rejects(() => createCpuReleaseArtifacts(plan, order({ currentRevision: 2, version: 2 }) as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan")), { code: "CPU_RELEASE_LINEAGE_CONFLICT" });
    const changed = structuredClone(plan);
    changed.menuItems[0].subItems[0].allergens.eggs = "contains";
    await assert.rejects(() => createCpuReleaseArtifacts(changed, order() as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan")), { code: "CPU_RELEASE_LINEAGE_CONFLICT" });
    const oneSignature = { ...plan, signatures: plan.signatures!.slice(0, 1) };
    await assert.rejects(() => createCpuReleaseArtifacts(oneSignature, order() as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan")), /Both required signatures/);
    assert.equal(calls.length, 2, "rejected source/matrix/dual-signature checks create no artifact");
    const fresh = structuredClone(plan);
    delete fresh.masterMatrixArtifact;
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).includes("/render/pdf")) return new Response(Buffer.from("%PDF-1.4 test"), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "Drive unavailable" } }), { status: 503 });
    }) as typeof fetch;
    await assert.rejects(() => createCpuReleaseArtifacts(fresh, order() as never, "test-chef", plan.updatedAt, new NextRequest("http://localhost/api/production-plan")), /Drive unavailable/);
    assert.equal(fresh.masterMatrixArtifact, undefined, "a failed durable write cannot claim an artifact");
    assert.equal(fresh.currentAllergenRelease?.status, "pending");
  } finally {
    globalThis.fetch = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});
