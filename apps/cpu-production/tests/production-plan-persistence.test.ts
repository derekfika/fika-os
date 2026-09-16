import assert from "node:assert/strict";
import test from "node:test";
import { matrixSignatureScope, type MatrixArtifact, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { compactProductionPlanForPersistence, createProductionPlanRepository, decodeProductionPlan } from "../lib/production-plan-repository";

const source = {
  sourceDayId: "publication-day:xchange:2026-09-14",
  sourcePublicationId: "publication:xchange:2026-09-14:v8",
  sourcePublicationDayId: "publication-day:xchange:2026-09-14:v8",
  sourceVersion: 8,
  sourceContentHash: "a".repeat(64),
};
const menuItems = [{
  id: "menu-item:xchange:1",
  name: "Xchange plated dish",
  note: "",
  subItems: [{ id: "sub-item:xchange:1", name: "Xchange plated dish", quantity: 1, allergens: { milk: "clear" }, note: "", evidenceStatus: "completed" as const }],
}] satisfies PlannedMenuItem[];
const scope = matrixSignatureScope({ canonicalId: "production-order:xchange", serviceDate: "2026-09-14", requiredBy: "2026-09-14T12:00:00.000Z", sourceEntityId: source.sourceDayId, ...source }, allergenMatrixContentHash(menuItems))!;
const signatureDataUrl = `data:image/png;base64,${"signature-pixels".repeat(1_500)}`;
const signatures = [
  { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-09-14T08:00:00.000Z", actor: "person:production-chef", attestation: "Reviewed the rendered matrix.", signatureDataUrl, scope },
  { role: "head_chef_site_manager" as const, printedName: "Head Chef / Site Manager", signedAt: "2026-09-14T08:01:00.000Z", actor: "person:head-chef", attestation: "Approved the rendered matrix.", signatureDataUrl, scope },
];

function artifact(id: string, html = `<html><body><p>${id}</p></body></html>`): MatrixArtifact {
  return {
    id,
    bookingId: "booking:xchange",
    fileName: `${id}.pdf`,
    createdAt: "2026-09-14T08:02:00.000Z",
    createdBy: "person:head-chef",
    contentHash: "b".repeat(64),
    html,
    pdfPath: `/tmp/${id}.pdf`,
    localUrl: `/artifacts/${id}.pdf`,
    pdfStatus: "generated",
    driveFileId: `drive:${id}`,
    driveUrl: `https://drive.example/${id}`,
    driveStatus: "saved",
    bundleId: `bundle:${id}`,
    packetContentHash: "c".repeat(64),
    packetObjectName: `packets/${id}.json.gz`,
    sourceRevision: 8,
    sourceContentHash: source.sourceContentHash,
  };
}

function release(version: number, previous: ReturnType<typeof buildCpuAllergenRelease> | undefined, html: string) {
  return buildCpuAllergenRelease({
    serviceDate: "2026-09-14",
    ...source,
    version,
    signedAt: `2026-09-14T08:0${version}:00.000Z`,
    signatures,
    items: menuItems,
    masterArtifact: artifact(`release-${version}-master`, html),
    derivedArtifacts: [artifact(`release-${version}-site-a`, html)],
    packetArtifacts: [artifact(`release-${version}-packet`, html)],
    previous,
  });
}

function planWithArtifacts(html = "<html>legacy</html>"): ProductionPlan {
  const historicalOne = release(1, undefined, html);
  const historicalTwo = release(2, historicalOne, html);
  const current = release(3, historicalTwo, html);
  return {
    id: "production-plan:production-order:xchange",
    orderId: "production-order:xchange",
    status: "planned",
    menuItems,
    planningNotes: "Xchange regression plan",
    signatures,
    signedMenuContentHash: scope.matrixContentHash,
    signedSignatures: signatures,
    matrixArtifact: artifact("top-level-matrix", html),
    masterMatrixArtifact: artifact("top-level-master", html),
    signedMatrixArtifact: artifact("top-level-signed", html),
    siteMatrixArtifacts: { "oploc:xchange-a": artifact("top-level-site-a", html), "oploc:xchange-b": artifact("top-level-site-b", html) },
    currentAllergenRelease: current,
    allergenReleaseHistory: [historicalOne, historicalTwo],
    updatedAt: "2026-09-14T08:03:00.000Z",
    updatedBy: "person:head-chef",
    audit: [{ action: "allergen-release-materialized", at: "2026-09-14T08:03:00.000Z", by: "person:head-chef" }],
  };
}

function withoutHtml(artifactValue: MatrixArtifact) {
  const { html: _html, ...metadata } = artifactValue;
  return metadata;
}

function assertArtifactCompacted(original: MatrixArtifact, compacted: MatrixArtifact) {
  assert.equal("html" in compacted, false);
  assert.deepEqual(compacted, withoutHtml(original));
}

function assertReleaseCompacted(original: NonNullable<ProductionPlan["currentAllergenRelease"]>, compacted: NonNullable<ProductionPlan["currentAllergenRelease"]>) {
  assertArtifactCompacted(original.masterArtifact, compacted.masterArtifact);
  original.derivedArtifacts.forEach((item, index) => assertArtifactCompacted(item, compacted.derivedArtifacts[index]));
  original.packetArtifacts.forEach((item, index) => assertArtifactCompacted(item, compacted.packetArtifacts[index]));
  assert.deepEqual(compacted.signatures, original.signatures);
  assert.deepEqual({ ...compacted, masterArtifact: undefined, derivedArtifacts: undefined, packetArtifacts: undefined }, { ...original, masterArtifact: undefined, derivedArtifacts: undefined, packetArtifacts: undefined });
}

test("compaction removes html from every ProductionPlan artifact location and preserves metadata", () => {
  const plan = planWithArtifacts();
  const before = structuredClone(plan);
  const compacted = compactProductionPlanForPersistence(plan);

  assertArtifactCompacted(plan.matrixArtifact!, compacted.matrixArtifact!);
  assertArtifactCompacted(plan.masterMatrixArtifact!, compacted.masterMatrixArtifact!);
  assertArtifactCompacted(plan.signedMatrixArtifact!, compacted.signedMatrixArtifact!);
  for (const [siteId, original] of Object.entries(plan.siteMatrixArtifacts!)) assertArtifactCompacted(original, compacted.siteMatrixArtifacts![siteId]);
  assertReleaseCompacted(plan.currentAllergenRelease!, compacted.currentAllergenRelease!);
  plan.allergenReleaseHistory!.forEach((item, index) => assertReleaseCompacted(item, compacted.allergenReleaseHistory![index]));
  assert.deepEqual(compacted.signatures, plan.signatures);
  assert.deepEqual(compacted.signedSignatures, plan.signedSignatures);
  assert.deepEqual(plan, before);
});

test("legacy ProductionPlan documents containing html still decode unchanged", () => {
  const legacy = planWithArtifacts("<html>historical artifact</html>");
  const decoded = decodeProductionPlan(legacy);
  assert.deepEqual(decoded, legacy);
  assert.equal(decoded.matrixArtifact?.html, "<html>historical artifact</html>");
});

test("save and saveAndAppendCpuChange persist compact plans without mutating the caller", async () => {
  const plan = planWithArtifacts();
  const before = structuredClone(plan);
  const priorStore = process.env.FIKA_CPU_PLAN_STORE;
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  try {
    const repository = createProductionPlanRepository();
    await repository.save(plan);
    const saved = await repository.get(plan.orderId);
    assert.equal("html" in saved!.matrixArtifact!, false);
    assert.deepEqual(plan, before);

    await repository.saveAndAppendCpuChange(plan, plan.updatedAt, { entityType: "productionPlan", entityId: plan.id, changeType: "persistence-compaction-test", actorId: "test", changedAt: plan.updatedAt });
    const appended = await repository.get(plan.orderId);
    assert.equal("html" in appended!.currentAllergenRelease!.masterArtifact, false);
    assert.deepEqual(plan, before);

    await assert.rejects(() => repository.save({ ...plan, updatedAt: "2026-09-14T09:00:00.000Z" }, "2026-09-14T08:59:59.000Z"), error => (error as { status?: number }).status === 409);
    await assert.rejects(() => repository.saveAndAppendCpuChange({ ...plan, updatedAt: "2026-09-14T09:00:00.000Z" }, "2026-09-14T08:59:59.000Z", { entityType: "productionPlan", entityId: plan.id, changeType: "stale-persistence-compaction-test", actorId: "test", changedAt: plan.updatedAt }), error => (error as { status?: number }).status === 409);
    assert.equal((await repository.get(plan.orderId))!.updatedAt, plan.updatedAt);
  } finally {
    if (priorStore === undefined) delete process.env.FIKA_CPU_PLAN_STORE;
    else process.env.FIKA_CPU_PLAN_STORE = priorStore;
  }
});

const renderedHtml = `<html><body><img alt="production chef signature" src="${signatureDataUrl}"><img alt="head chef site manager signature" src="${signatureDataUrl}"><table>${"<tr><td>Allergen matrix row rendered for Xchange service day</td></tr>".repeat(1_250)}</table></body></html>`;
const xchangePlan = planWithArtifacts(renderedHtml);
const xchangeCompactedPlan = compactProductionPlanForPersistence(xchangePlan);
const serializedSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const uncompactedSize = serializedSize(xchangePlan);
const compactedSize = serializedSize(xchangeCompactedPlan);

test(`Xchange-sized generated HTML is over 1 MiB before compaction and safely below it after (${uncompactedSize} -> ${compactedSize} bytes)`, () => {
  const plan = xchangePlan;
  const compacted = xchangeCompactedPlan;

  assert.ok(uncompactedSize > 1_048_576, `expected un-compacted candidate to exceed 1 MiB, got ${uncompactedSize}`);
  assert.ok(compactedSize < 1_048_576, `expected compact candidate below 1 MiB, got ${compactedSize}`);
  assert.ok(compactedSize < 512 * 1024, `expected compact candidate to have a safe margin, got ${compactedSize}`);
  assert.deepEqual(plan.signatures, compacted.signatures);
  assert.deepEqual(plan.currentAllergenRelease!.signatures, compacted.currentAllergenRelease!.signatures);
});
