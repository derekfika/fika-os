import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { assertCpuReleaseRowsAttested, createCpuMasterArtifact, createCpuReleaseArtifacts, materializeCommittedCpuRelease } from "../lib/cpu-release-materialization";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";
import { matrixSignatureScope, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import type { ProductionOrder } from "../lib/production-types";

const order = {
  canonicalId: "production-order:haleon",
  entityType: "Production Order",
  schemaVersion: "1",
  version: 3,
  requirementIds: [],
  sourceBookingId: "booking:haleon",
  sourceQuoteRevisionId: "quote:haleon",
  sourceEntityId: "publication-day:2026-09-14",
  sourcePublicationId: "publication:2026-09-14",
  sourcePublicationDayId: "publication-day:2026-09-14",
  sourceVersion: 8,
  sourceContentHash: "b".repeat(64),
  destinationOplocId: "oploc:haleon",
  destinationLabel: "Haleon",
  serviceDate: "2026-09-14",
  requiredBy: "2026-09-14T12:00:00.000Z",
  serviceWindow: { startTime: "12:00" },
  status: "planned",
  priority: "normal",
  lines: [],
  exceptions: [],
  origin: "menu_planning",
  currentRevision: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "menu-planning",
  idempotencyKey: "order:haleon",
  externalReferences: [],
  audit: [],
} as unknown as ProductionOrder;

const legacyAllergens = Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, key === "no_key_allergens" ? "contains" : "clear"])) as Record<string, "clear" | "contains">;
const rowItems = (variant: "legacy" | "blank" | "declared" | "positives"): PlannedMenuItem[] => [{
  id: "menu-item:1",
  name: "Dish",
  note: "",
  subItems: [{ id: "sub-item:1", name: "Dish", quantity: 1, allergens: variant === "blank" ? {} : variant === "positives" ? { ...legacyAllergens, no_key_allergens: "clear" as const, milk: "contains" as const } : legacyAllergens, ...(variant === "declared" ? { noKeyDeclaration: { declared: true as const, declaredBy: "Chef A", declaredAt: "2026-09-14T07:00:00.000Z" } } : {}), note: "", evidenceStatus: "completed" as const }],
}];
let menuItems = rowItems("legacy");
function signaturesFor(items: typeof menuItems) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(items))!;
  return { scope, signatures: [
  { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-09-14T08:00:00.000Z", actor: "chef", attestation: "Reviewed the matrix.", scope },
  { role: "head_chef_site_manager" as const, printedName: "Head Chef", signedAt: "2026-09-14T08:01:00.000Z", actor: "head", attestation: "Approved the matrix.", scope },
  ] };
}

function planWithRelease(materializationStatus: "pending" | "ready" = "pending") {
  const { scope, signatures } = signaturesFor(menuItems);
  const release = buildCpuAllergenRelease({
    serviceDate: scope.serviceDate,
    sourceDayId: scope.sourceDayId,
    sourcePublicationId: scope.sourcePublicationId,
    sourcePublicationDayId: scope.sourcePublicationDayId,
    sourceVersion: scope.sourceVersion,
    sourceContentHash: scope.sourceContentHash,
    version: 1,
    signedAt: "2026-09-14T08:01:00.000Z",
    signatures,
    items: menuItems,
    masterArtifact: { id: "pending-master", bookingId: order.sourceBookingId, fileName: "pending.pdf", createdAt: "2026-09-14T08:01:00.000Z", createdBy: "chef", contentHash: "c".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" },
    derivedArtifacts: [],
    packetArtifacts: [],
    status: "pending",
  });
  if (materializationStatus === "ready") {
    release.status = "current";
    release.materializationStatus = "ready";
  }
  return {
    id: "production-plan:production-order:haleon",
    orderId: order.canonicalId,
    status: "planned" as const,
    menuItems,
    planningNotes: "",
    signatures,
    signedMenuContentHash: scope.matrixContentHash,
    signedSignatures: signatures,
    currentAllergenRelease: release,
    updatedAt: "2026-09-14T08:02:00.000Z",
    updatedBy: "chef",
    audit: [{ action: "allergen-matrix-signature-complete", at: "2026-09-14T08:01:00.000Z", by: "head" }],
  } satisfies ProductionPlan;
}


const request = () => new NextRequest("http://localhost/api/internal/cpu-release-materialize", { method: "POST" });
async function withEnv<T>(fn: (calls: string[]) => Promise<T>) {
  const previous = { store: process.env.FIKA_CPU_PLAN_STORE, mode: process.env.FIKA_RUNTIME_MODE, fetch: globalThis.fetch };
  process.env.FIKA_CPU_PLAN_STORE = "memory"; process.env.FIKA_RUNTIME_MODE = "local";
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input); calls.push(url);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order }), { status: 200 });
    throw new Error(`Unexpected outbound call (nothing may be published): ${url}`);
  }) as typeof fetch;
  try { return await fn(calls); } finally {
    globalThis.fetch = previous.fetch;
    if (previous.store === undefined) delete process.env.FIKA_CPU_PLAN_STORE; else process.env.FIKA_CPU_PLAN_STORE = previous.store;
    if (previous.mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous.mode;
  }
}
const heldWith = (kind: string) => (error: unknown) => (error as { status?: number }).status === 422 && (error as { code?: string }).code === "CPU_ALLERGEN_ROW_UNVERIFIED" && (error as { unverifiedRows?: Array<{ kind: string }> }).unverifiedRows?.[0]?.kind === kind;

test("issue 225: the release gate holds blank, legacy derived and conflicting rows and passes attested rows", () => {
  assert.throws(() => assertCpuReleaseRowsAttested(rowItems("legacy")), heldWith("no-key-legacy"));
  assert.throws(() => assertCpuReleaseRowsAttested(rowItems("blank")), heldWith("row-blank"));
  const conflict = rowItems("declared"); conflict[0].subItems[0].allergens = { ...legacyAllergens, milk: "contains" };
  assert.throws(() => assertCpuReleaseRowsAttested(conflict), heldWith("no-key-conflict"));
  assert.doesNotThrow(() => assertCpuReleaseRowsAttested(rowItems("declared")));
  assert.doesNotThrow(() => assertCpuReleaseRowsAttested(rowItems("positives")));
});

test("issue 225: pending materialization retry of a legacy No Key row publishes nothing and writes nothing", async () => {
  await withEnv(async calls => {
    menuItems = rowItems("legacy");
    const plan = planWithRelease();
    const repository = createProductionPlanRepository();
    await repository.save(structuredClone(plan), null);
    const before = JSON.stringify(await repository.get(order.canonicalId));
    await assert.rejects(() => materializeCommittedCpuRelease(request(), order.canonicalId, plan.currentAllergenRelease!.releaseId), heldWith("no-key-legacy"));
    assert.equal(JSON.stringify(await repository.get(order.canonicalId)), before, "no started receipt, audit entry, artifact or release change was persisted");
    assert.deepEqual(calls.filter(url => !url.includes("/api/production?canonicalId=")), [], "no Drive upload, package publication or downstream event");
    const direct: ProductionPlan = structuredClone(plan);
    await assert.rejects(() => createCpuReleaseArtifacts(direct, order, "chef", "2026-09-14T08:05:00.000Z", request()), heldWith("no-key-legacy"));
    await assert.rejects(() => createCpuMasterArtifact(direct, order, "chef", "2026-09-14T08:05:00.000Z", request()), heldWith("no-key-legacy"));
    assert.equal(direct.masterMatrixArtifact, undefined);
    assert.equal(direct.siteMatrixArtifacts, undefined);
    menuItems = rowItems("blank");
    const blank = planWithRelease();
    await assert.rejects(() => createCpuReleaseArtifacts(blank, order, "chef", "2026-09-14T08:05:00.000Z", request()), heldWith("row-blank"));
    assert.deepEqual(calls.filter(url => !url.includes("/api/production?canonicalId=")), []);
  });
});

test("issue 225: a fully attested row passes the gate and proceeds to the normal materialization steps", async () => {
  await withEnv(async calls => {
    menuItems = rowItems("declared");
    const plan = planWithRelease();
    // Not held by the attestation gate: it proceeds to the next normal requirement (a configured Drive workspace) rather than CPU_ALLERGEN_ROW_UNVERIFIED.
    await assert.rejects(() => createCpuReleaseArtifacts(plan, order, "chef", "2026-09-14T08:05:00.000Z", request()), error => (error as { code?: string }).code !== "CPU_ALLERGEN_ROW_UNVERIFIED");
    menuItems = rowItems("positives");
    await assert.rejects(() => createCpuReleaseArtifacts(planWithRelease(), order, "chef", "2026-09-14T08:05:00.000Z", request()), error => (error as { code?: string }).code !== "CPU_ALLERGEN_ROW_UNVERIFIED");
    assert.deepEqual(calls, []);
  });
});
