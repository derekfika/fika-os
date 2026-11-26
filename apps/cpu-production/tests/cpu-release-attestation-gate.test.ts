import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { NextRequest } from "next/server";
import { assertCpuReleaseRowsAttested, createCpuMasterArtifact, createCpuReleaseArtifacts, materializeCommittedCpuRelease } from "../lib/cpu-release-materialization";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import { retryCommittedCpuMaterialization } from "../lib/cpu-retry-materialization";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";
import { matrixSignatureScope, planRevisionToken, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
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
function signaturesFor(items: typeof menuItems, sourceOrder = order) {
  const scope = matrixSignatureScope(sourceOrder, allergenMatrixContentHash(items))!;
  return { scope, signatures: [
  { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-09-14T08:00:00.000Z", actor: "chef", attestation: "Reviewed the matrix.", scope },
  { role: "head_chef_site_manager" as const, printedName: "Head Chef", signedAt: "2026-09-14T08:01:00.000Z", actor: "head", attestation: "Approved the matrix.", scope },
  ] };
}

function planWithRelease(materializationStatus: "pending" | "ready" = "pending", sourceOrder = order) {
  const { scope, signatures } = signaturesFor(menuItems, sourceOrder);
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
    id: `production-plan:${sourceOrder.canonicalId}`,
    orderId: sourceOrder.canonicalId,
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
async function withEnv<T>(fn: (calls: string[]) => Promise<T>, sourceOrder = order) {
  const previous = { store: process.env.FIKA_CPU_PLAN_STORE, mode: process.env.FIKA_RUNTIME_MODE, fetch: globalThis.fetch };
  process.env.FIKA_CPU_PLAN_STORE = "memory"; process.env.FIKA_RUNTIME_MODE = "local";
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input); calls.push(url);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order: sourceOrder }), { status: 200 });
    throw new Error(`Unexpected outbound call (nothing may be published): ${url}`);
  }) as typeof fetch;
  try { return await fn(calls); } finally {
    globalThis.fetch = previous.fetch;
    if (previous.store === undefined) delete process.env.FIKA_CPU_PLAN_STORE; else process.env.FIKA_CPU_PLAN_STORE = previous.store;
    if (previous.mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous.mode;
  }
}
const heldWith = (kind: string) => (error: unknown) => (error as { status?: number }).status === 422 && (error as { code?: string }).code === "CPU_ALLERGEN_ROW_UNVERIFIED" && (error as { unverifiedRows?: Array<{ kind: string }> }).unverifiedRows?.[0]?.kind === kind;

test("retry and direct materialization reject incomplete frozen signatures before replay or persistence", async () => {
  const fixture = { ...order, canonicalId: "production-order:frozen-signatures" };
  await withEnv(async calls => {
    menuItems = rowItems("declared");
    const repository = createProductionPlanRepository();
    const plan = planWithRelease("pending", fixture);
    const scope = signaturesFor(menuItems, fixture).scope;
    const [chef, manager] = plan.currentAllergenRelease.signatures;
    const rejected = { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" };
    for (const frozen of [
      [], [chef], [manager], [chef, chef], [chef, { ...manager, valid: false }],
      [chef, { ...manager, scope: { ...scope, matrixContentHash: "0".repeat(64) } }],
    ]) {
      plan.currentAllergenRelease.signatures = frozen;
      const previous = await repository.get(fixture.canonicalId);
      await repository.save(structuredClone(plan), planRevisionToken(previous));
      const before = await repository.get(fixture.canonicalId);
      await assert.rejects(() => retryCommittedCpuMaterialization({
        plan, order: fixture, expectedLineage: scope, timestamp: "2026-09-14T08:05:00.000Z",
      }, {
        replay: async () => assert.fail("A rejected retry must not requeue the outbox event"),
        deliver: async () => assert.fail("A rejected retry must not deliver the outbox event"),
      }), rejected);
      await assert.rejects(() => materializeCommittedCpuRelease(request(), fixture.canonicalId, plan.currentAllergenRelease.releaseId), rejected);
      await assert.rejects(() => createCpuMasterArtifact(plan, fixture, "fixture", plan.updatedAt, request()), rejected);
      await assert.rejects(() => createCpuReleaseArtifacts(plan, fixture, "fixture", plan.updatedAt, request()), rejected);
      assert.deepEqual(await repository.get(fixture.canonicalId), before);
    }
    assert.deepEqual(calls.filter(url => !url.includes("/api/production?canonicalId=")), []);
  }, fixture);
});

test("the master and site PDFs print the two committed signers when the editable plan has a different signer and no second role", async t => {
  const snapshotDir = await fs.mkdtemp(path.join(tmpdir(), "cpu-frozen-signer-test-"));
  const priorEnv = process.env;
  process.env = { ...priorEnv, FIKA_RUNTIME_MODE: "local", FIKA_CPU_PLAN_STORE: "memory", FIKA_SNAPSHOT_DIR: snapshotDir, CHROME_PATH: "fixture-renderer", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "{}", GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION: "fixture@example.test" };
  t.after(async () => { process.env = priorEnv; await fs.rm(snapshotDir, { recursive: true, force: true }); });
  const renderedHtml: string[] = [];
  t.mock.method(childProcess, "spawn", (_browser: string, args: string[]) => {
    const output = args.find(arg => arg.startsWith("--print-to-pdf="));
    assert.ok(output);
    const child = new EventEmitter();
    const input = fileURLToPath(args.at(-1)!);
    void fs.readFile(input, "utf8").then(html => {
      renderedHtml.push(html);
      return fs.writeFile(output.slice("--print-to-pdf=".length), "%PDF-1.7\nfixture\n%%EOF");
    }).then(() => child.emit("exit", 0), error => child.emit("error", error));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const savedHtml: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(new URL(String(url)).pathname, "/api/allergen-matrix/drive");
    savedHtml.push(JSON.parse(String(init?.body)).html);
    return Response.json({ saved: { fileId: `fixture-file-${savedHtml.length}` } });
  });
  menuItems = rowItems("declared");
  const plan = planWithRelease();
  plan.currentAllergenRelease.signatures[0].printedName = "Frozen signer Alpha";
  plan.currentAllergenRelease.signatures[1].printedName = "Frozen signer Beta";
  plan.signatures = [{ ...plan.signatures[0], printedName: "Mutable signer Gamma" }];
  const masterArtifact = await createCpuMasterArtifact(plan, order, "fixture", plan.updatedAt, request());
  const { siteArtifact } = await createCpuReleaseArtifacts(plan, order, "fixture", plan.updatedAt, request(), { masterArtifact, publishPackage: false });
  if (siteArtifact.pdfPath) await fs.unlink(siteArtifact.pdfPath);
  assert.equal(savedHtml.length, 2);
  assert.deepEqual(renderedHtml, savedHtml);
  assert.deepEqual(savedHtml, [masterArtifact.html, siteArtifact.html]);
  for (const html of savedHtml) {
    assert.match(html, /Frozen signer Alpha/);
    assert.match(html, /Frozen signer Beta/);
    assert.doesNotMatch(html, /Mutable signer Gamma/);
  }
  const revoked = structuredClone(plan);
  revoked.currentAllergenRelease.status = "revoked";
  const held = { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" };
  await assert.rejects(() => createCpuMasterArtifact(revoked, order, "fixture", plan.updatedAt, request()), held);
  await assert.rejects(() => createCpuReleaseArtifacts(revoked, order, "fixture", plan.updatedAt, request()), held);
  assert.equal(renderedHtml.length, 2);
  assert.equal(savedHtml.length, 2);
});

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
