import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildDailyAllergenPacket, assertDailyAllergenPacket } from "@fika/server-shared/daily-signed-oploc-bundle";
import { stampAllergenReviews } from "../app/lib/allergen-review-stamp";
import { matrixSignatureScope, signatureMatchesScope, currentAllergenReleaseMatchesOrder, type PlannedMenuItem, type InternalMatrixSignature } from "../app/lib/production-plan";
import { allergenMatrixContentHash, releaseMatrix, allergenReleaseDelta, allergenReleaseNoteDelta, buildCpuAllergenRelease, publishCpuAllergenRelease, type CpuAllergenRelease } from "../lib/cpu-allergen-release";
import { buildCpuPacketItems } from "../lib/cpu-packet-identity";
import { MenuItem } from "../lib/production-plan-command-schema";
import { confirmRowExplicit, isExplicitRowConfirmed } from "../../shared/allergen-declaration";
import type { ProductionOrder } from "../lib/production-types";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { cpuProjectionToOrders } from "../lib/cpu-dashboard-adapter";
import { buildCpuReviewProjection } from "../lib/cpu-review-package";
import { NextRequest } from "next/server";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import { materializeCommittedCpuRelease } from "../lib/cpu-release-materialization";
import type { ProductionPlan } from "../app/lib/production-plan";
import { cpuDestinationAllowed, requireCpuActor, requireCpuDestinationScope } from "../lib/cpu-access-client";
import { productionOrderDetail } from "../lib/production-http-client";

const at = "2098-11-02T09:00:00Z";
const order = { canonicalId: "production:synthetic", serviceDate: "2098-11-02", requiredBy: "2098-11-02T12:00:00Z", origin: "menu_planning", sourceEntityId: "week:synthetic:day:0", sourcePublicationDayId: "publication:synthetic:day:0:v1", sourceVersion: 1, sourceContentHash: "a".repeat(64), lines: [{ canonicalId: "line:synthetic", sourceMenuItemId: "dish:synthetic" }] } as ProductionOrder;
test("CPU read packages retain one-off routing identity and snapshot alongside governed destinations", () => {
  const destination: NonNullable<ProductionOrder["destination"]> = { kind: "one-off", id: "week:synthetic:day:0:one-off:venue", sourceDayId: "week:synthetic:day:0", label: "Synthetic venue", address: "1 Test Road", contact: "Test kitchen", deliveryInstructions: "Side entrance" };
  const source: ProductionOrder = { ...order, destinationOplocId: destination.id, destinationLabel: destination.label, destination, status: "accepted", priority: "normal", version: 1, exceptions: [], lines: [{ ...order.lines[0], itemName: "Synthetic dish", customerQuantity: 7, customerUnit: "portion", productionQuantity: 7, productionUnit: "portion", status: "ready", sortOrder: 0 }] };
  const governed: ProductionOrder = { ...source, canonicalId: "production:governed", destinationOplocId: "oploc:synthetic", destination: { kind: "governed", id: "oploc:synthetic", label: "Synthetic governed site" } };
  const projection = buildCpuDayProjection(order.serviceDate!, [source, governed]);
  const reloaded = cpuProjectionToOrders(JSON.parse(JSON.stringify(projection)));
  assert.deepEqual(reloaded[0].destination, destination);
  assert.equal(reloaded[0].destinationOplocId, destination.id);
  assert.equal(reloaded[0].lines[0].customerQuantity, 7);
  assert.deepEqual(reloaded[1].destination, governed.destination);
});

test("one-off access needs explicit trusted global scope and shares the existing admission read", async () => {
  const previousFetch = globalThis.fetch;
  const destination = { kind: "one-off" as const, id: "week:synthetic:day:0:one-off:venue", sourceDayId: "week:synthetic:day:0", label: "Synthetic venue", address: "1 Test Road" };
  try {
    for (const allOplocs of [true, false, undefined]) {
      let admissions = 0;
      let includeSnapshot = true;
      globalThis.fetch = (async input => {
        if (String(input).includes("/api/cpu-production/access")) {
          admissions += 1;
          return Response.json({ principal: { id: "synthetic-chef" }, oplocs: [{ id: "oploc:synthetic" }, { id: destination.id }], ...(allOplocs !== undefined ? { allOplocs } : {}) });
        }
        return Response.json({ order: { ...order, version: 1, ...(includeSnapshot ? { destination } : {}), destinationOplocId: destination.id } });
      }) as typeof fetch;
      const request = new NextRequest("http://localhost/api/production-plan", { headers: { cookie: "synthetic-session=isolated" } });
      assert.equal((await requireCpuActor(request)).uid, "synthetic-chef");
      const scope = await requireCpuDestinationScope(request);
      assert.equal(admissions, 1, "scope and actor share one bounded Hub admission read");
      assert.equal(cpuDestinationAllowed(scope, "oploc:synthetic"), true);
      assert.equal(cpuDestinationAllowed(scope, destination.id, destination), allOplocs === true);
      assert.equal(cpuDestinationAllowed(scope, "oploc:unrelated"), allOplocs === true);
      if (allOplocs === true) assert.deepEqual((await productionOrderDetail(request, order.canonicalId)).destination, destination);
      else await assert.rejects(productionOrderDetail(request, order.canonicalId), { status: 403, code: "CPU_DESTINATION_SCOPE_DENIED" });
      includeSnapshot = false;
      if (allOplocs === true) assert.equal((await productionOrderDetail(request, order.canonicalId)).destinationOplocId, destination.id);
      else await assert.rejects(productionOrderDetail(request, order.canonicalId), { status: 403, code: "CPU_DESTINATION_SCOPE_DENIED" });
      assert.equal(admissions, 1);
    }
  } finally { globalThis.fetch = previousFetch; }
});
const items = (detail = "Almond and wheat", may = "Shared sesame equipment"): PlannedMenuItem[] => {
  const allergens = confirmRowExplicit({ allergens: { tree_nuts: "contains", gluten: "contains", sesame: "may_contain" }, identity: "Synthetic dish", allergenDetailNotes: detail, mayContainNotes: may, actor: "synthetic-chef", now: at }).allergens;
  return [{ id: "menu:synthetic", sourceLineId: "line:synthetic", name: "Synthetic dish", note: "", subItems: [{ id: "sub:synthetic", name: "Synthetic dish", quantity: 4, allergens, allergenDetailNotes: detail, mayContainNotes: may, note: "", evidenceStatus: "completed" }] }];
};
const signatures = (menuItems: PlannedMenuItem[]): InternalMatrixSignature[] => (["production_chef", "head_chef_site_manager"] as const).map(role => ({ role, printedName: "Synthetic Chef", signedAt: at, actor: "synthetic-chef", attestation: "Synthetic checked evidence", scope: matrixSignatureScope(order, allergenMatrixContentHash(menuItems))! }));
const artifact = { id: "artifact:synthetic", bookingId: "synthetic", fileName: "synthetic.pdf", createdAt: at, createdBy: "synthetic-chef", contentHash: "b".repeat(64), pdfStatus: "generated" as const, driveStatus: "not_configured" as const, localUrl: "/synthetic.pdf" };
const build = (menuItems: PlannedMenuItem[], previous?: CpuAllergenRelease) => buildCpuAllergenRelease({ serviceDate: order.serviceDate!, sourceDayId: order.sourceEntityId!, sourcePublicationDayId: order.sourcePublicationDayId!, sourceVersion: 1, sourceContentHash: order.sourceContentHash!, version: previous ? previous.version + 1 : 1, signedAt: at, signatures: signatures(menuItems), items: menuItems, masterArtifact: artifact, derivedArtifacts: [], packetArtifacts: [], previous });

test("specific and may-contain notes survive command validation, server review stamping and serialised reload", () => {
  const sent = items().map(item => MenuItem.parse(JSON.parse(JSON.stringify(item))));
  const saved = stampAllergenReviews([], sent, "synthetic-chef", at);
  const reloaded: PlannedMenuItem[] = JSON.parse(JSON.stringify(saved));
  const row = reloaded[0].subItems[0];
  assert.equal(row.allergenDetailNotes, "Almond and wheat");
  assert.equal(row.mayContainNotes, "Shared sesame equipment");
  assert.equal(row.allergenReview?.confirmedBy, "synthetic-chef");
  assert.equal(row.allergenReview?.semantics, 3);
  assert.ok(isExplicitRowConfirmed({ ...row, identity: row.name, review: row.allergenReview?.semantics === 3 ? row.allergenReview : undefined }));
  assert.equal(stampAllergenReviews(reloaded, reloaded, "other-chef", "2098-11-02T10:00:00Z")[0].subItems[0].allergenReview?.confirmedAt, at);
});

test("a specific detail amendment invalidates old review proof, signed scope and current release authority", () => {
  const saved = stampAllergenReviews([], items(), "synthetic-chef", at);
  const amended = structuredClone(saved);
  amended[0].subItems[0].allergenDetailNotes = "Cashew and barley";
  const prior = saved[0].subItems[0], changed = amended[0].subItems[0];
  assert.ok(!isExplicitRowConfirmed({ ...changed, identity: changed.name, review: prior.allergenReview?.semantics === 3 ? prior.allergenReview : undefined }));
  assert.notEqual(allergenMatrixContentHash(saved), allergenMatrixContentHash(amended));
  assert.equal(signatureMatchesScope(signatures(saved)[0], matrixSignatureScope(order, allergenMatrixContentHash(amended))), false);
  assert.equal(currentAllergenReleaseMatchesOrder(build(saved), order, amended), false);
  changed.evidenceStatus = "not_completed";
  assert.equal(stampAllergenReviews(saved, amended, "other-chef", at)[0].subItems[0].allergenReview, undefined);
  changed.evidenceStatus = "completed";
  const confirmedAgain = stampAllergenReviews(saved, amended, "other-chef", "2098-11-02T10:00:00Z")[0].subItems[0];
  assert.equal(confirmedAgain.allergenReview?.confirmedBy, "other-chef");
  assert.notEqual(confirmedAgain.allergenReview?.inputFingerprint, prior.allergenReview?.inputFingerprint);
});

test("withdrawal removes current CPU review authority even when immutable publication hash is unchanged", () => {
  const menuItems = items();
  const release = { ...build(menuItems), status: "current" as const, materializationStatus: "ready" as const };
  assert.equal(currentAllergenReleaseMatchesOrder(release, order, menuItems), true);
  for (const routingId of ["oploc:synthetic", "week:synthetic:day:0:one-off:venue"]) {
    const withdrawn = { ...order, destinationOplocId: routingId, status: "cancelled" as const };
    assert.equal(matrixSignatureScope(withdrawn, release.matrixContentHash), undefined);
    assert.equal(currentAllergenReleaseMatchesOrder(release, withdrawn, menuItems), false);
    const projection = buildCpuReviewProjection(order.serviceDate!, routingId, [withdrawn], []);
    assert.equal(projection.status, "valid_empty");
    assert.deepEqual(projection.sourceOrders, []);
    assert.deepEqual(projection.signatures, []);
  }
  assert.equal(release.status, "current", "historical release evidence remains unchanged");
});

test("pending Menu packet materialization performs no writes or external work after source withdrawal", async () => {
  const previous = { fetch: globalThis.fetch, store: process.env.FIKA_CPU_PLAN_STORE, mode: process.env.FIKA_RUNTIME_MODE };
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  process.env.FIKA_RUNTIME_MODE = "local";
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); calls.push(url);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order: { ...order, version: 1, status: "cancelled" } }));
    throw new Error(`Unexpected external work: ${url}`);
  }) as typeof fetch;
  try {
    const menuItems = items();
    const release = { ...build(menuItems), status: "pending" as const, materializationStatus: "pending" as const };
    const plan: ProductionPlan = { id: `production-plan:${order.canonicalId}`, orderId: order.canonicalId, status: "planned", menuItems, planningNotes: "", signatures: signatures(menuItems), currentAllergenRelease: release, updatedAt: at, updatedBy: "synthetic-chef", audit: [] };
    const repository = createProductionPlanRepository();
    await repository.save(plan, null);
    const before = JSON.stringify(await repository.get(order.canonicalId));
    await assert.rejects(materializeCommittedCpuRelease(new NextRequest("http://localhost/api/internal/cpu-release-materialize"), order.canonicalId, release.releaseId), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
    assert.equal(JSON.stringify(await repository.get(order.canonicalId)), before);
    assert.equal(calls.length, 1, "only canonical authority was read; no upload or downstream event");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["FIKA_CPU_PLAN_STORE", previous.store], ["FIKA_RUNTIME_MODE", previous.mode]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("daily packet retains canonical identity, exact review proof, separate notes and unknown state", () => {
  const saved = stampAllergenReviews([], items(), "synthetic-chef", at);
  saved[0].subItems.push({ id: "sub:unknown", name: "Synthetic unknown", quantity: 1, allergens: {}, allergenDetailNotes: "Await supplier", mayContainNotes: "Not reviewed", note: "", evidenceStatus: "not_completed" });
  const packetItems = buildCpuPacketItems(saved, order);
  const { packet } = buildDailyAllergenPacket({ bundleId: "bundle:synthetic", serviceDate: order.serviceDate!, oploc: { id: "oploc:synthetic", name: "Synthetic site" }, source: { id: order.canonicalId, revision: 1, contentHash: order.sourceContentHash! }, items: packetItems });
  const reloaded = JSON.parse(JSON.stringify(packet));
  assertDailyAllergenPacket(reloaded);
  assert.equal(reloaded.items[0].menuItemId, "dish:synthetic");
  assert.deepEqual(reloaded.items[0].allergenReview, saved[0].subItems[0].allergenReview);
  assert.equal(reloaded.items[0].allergenDetailNotes, "Almond and wheat");
  assert.equal(reloaded.items[0].mayContainNotes, "Shared sesame equipment");
  assert.equal(reloaded.items[0].allergens.sesame, "may_contain");
  assert.equal(reloaded.items[1].allergenState, "unrecorded");
  assert.deepEqual(reloaded.items[1].allergens, {});
  reloaded.items[0].allergenDetailNotes = "Silently amended";
  assert.throws(() => assertDailyAllergenPacket(reloaded), /evidence|integrity/);
});

test("release matrix binds both notes and reports prose changes separately from allergen-state deltas", () => {
  const before = build(items());
  const after = build(items("Cashew and barley", "Shared mustard equipment"), before);
  assert.equal(after.matrix[0].allergenDetailNotes, "Cashew and barley");
  assert.equal(after.matrix[0].mayContainNotes, "Shared mustard equipment");
  assert.notEqual(before.matrixContentHash, after.matrixContentHash);
  assert.deepEqual(after.deltaFromPrevious, []);
  assert.deepEqual(after.noteChangesFromPrevious?.map(change => [change.field, change.previously, change.now]), [["allergenDetailNotes", "Almond and wheat", "Cashew and barley"], ["mayContainNotes", "Shared sesame equipment", "Shared mustard equipment"]]);
  assert.equal(publishCpuAllergenRelease(before, after).current, after);
  const tampered = structuredClone(after);
  tampered.matrix[0].allergenDetailNotes = "Silently changed";
  assert.throws(() => publishCpuAllergenRelease(before, tampered), /hash mismatch/);
});

test("legacy rows without optional notes retain their release matrix bytes and hash", () => {
  const legacy = items("", "");
  delete legacy[0].subItems[0].allergenDetailNotes;
  delete legacy[0].subItems[0].mayContainNotes;
  const historicalMatrix = legacy.flatMap(item => item.subItems.map((sub, index) => ({ menuItemId: `${item.id}:${sub.id || index}`, dishName: sub.name || item.name, allergens: { ...sub.allergens } })));
  const expectedHash = createHash("sha256").update(JSON.stringify(historicalMatrix)).digest("hex");
  assert.deepEqual(releaseMatrix(legacy), historicalMatrix);
  const release = build(legacy);
  assert.equal(release.matrixContentHash, expectedHash);
  assert.equal(release.noteChangesFromPrevious, undefined);
  const blankOptional = items("   ", "");
  assert.deepEqual(releaseMatrix(blankOptional), historicalMatrix);
  assert.equal(allergenMatrixContentHash(legacy), allergenMatrixContentHash(blankOptional));
});

test("note metadata records added and removed evidence without inventing allergen-state changes", () => {
  const previous = build(items());
  const withoutNotes = items("", "");
  assert.deepEqual(allergenReleaseDelta(previous, withoutNotes), []);
  assert.deepEqual(allergenReleaseNoteDelta(previous, withoutNotes).map(change => change.now), ["", ""]);
  const removedRows = allergenReleaseNoteDelta(previous, []);
  assert.equal(removedRows.length, 2);
  assert.ok(removedRows.every(change => change.now === ""));
  assert.equal(allergenReleaseNoteDelta(build(withoutNotes), items()).length, 2);
});
