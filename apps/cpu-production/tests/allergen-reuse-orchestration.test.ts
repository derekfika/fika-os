import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The real memory plan repository, memory authority store and memory outbox are used (no Firestore, no HTTP).
process.env.FIKA_CPU_PLAN_STORE = "memory";
const { createProductionPlanRepository } = await import("../lib/production-plan-repository");
const { memoryAllergenAuthorityStore } = await import("../lib/allergen-authority-store");
const orchestrator = await import("../lib/allergen-reuse-orchestrator");
const { applyReuseCommand, cascadeAuthorityRevocation, approvedMatrixChanged, processAuthorityRevocation, reconcileAuthorityCascades, recordSignedApproval, AUTHORITY_REVOKED_ROUTE, authorityRevocationEventId } = orchestrator;
const service = await import("../lib/allergen-reuse-service");
const { reuseViewFor, reuseCandidateFor, guardReusedPlan, validateReusedApproval, assertReusedApprovalValid, reconcileReuse } = service;
const { loadGuardedPlansForOrders } = await import("../lib/cpu-guarded-plans");
const { resetCpuOutboxForTests, listCpuOutboxForTests } = await import("../lib/cpu-durable-outbox");
const { materializeCpuAllergenRelease } = await import("../lib/cpu-allergen-release");
const { currentAllergenReleaseMatchesOrder, reusedAuthorityReleaseMatchesOrder, hasAllergenAuthority } = await import("../app/lib/production-plan");
const { compositionIdentity } = await import("../lib/allergen-composition");
const { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } = await import("../../shared/allergen-contract");
import type { ProductionPlan } from "../app/lib/production-plan";

const AT = "2026-10-12T10:00:00.000Z";
const store = memoryAllergenAuthorityStore;
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));
const order = (id: string, items: string[], extra: Record<string, unknown> = {}, lineExtra: Record<string, unknown> = {}) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site",
  lines: items.map((item, index) => ({ canonicalId: `${id}:${index}`, sourceMenuItemId: item, choices: [], workstream: "sandwiches", customerQuantity: 10 + index, itemName: `Display ${index}`, ...lineExtra })),
  ...extra,
}) as never as import("../lib/production-types").ProductionOrder & { lines: Array<{ canonicalId: string }> };
type O = ReturnType<typeof order>;
const itemOf = (o: O, i: number) => (o.lines[i] as never as { sourceMenuItemId: string }).sourceMenuItemId;
const planFor = (o: O, over: Record<string, Record<string, string>> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planning", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((line, i) => ({ id: `mi:${i}`, sourceLineId: line.canonicalId, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${itemOf(o, i)}`, name: `Filling ${i}`, quantity: 10, allergens: states(over[itemOf(o, i)] || {}) as never, note: "", evidenceStatus: "completed" as const }] })),
  ...extra,
}) as ProductionPlan;
const blank = (p: ProductionPlan) => { for (const item of p.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; } return p; };
const signedRelease = (o: O, releaseId: string, stamp = true) => {
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
  return { signatures, release: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, ...(stamp ? { compositionId: compositionIdentity(o as never)?.compositionId } : {}), masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never };
};
const signedPlan = (o: O, releaseId: string, over: Record<string, Record<string, string>> = {}, stamp = true) => {
  const { signatures, release } = signedRelease(o, releaseId, stamp);
  return planFor(o, over, { status: "planned", signatures, signedSignatures: signatures, signedMenuContentHash: "h", currentAllergenRelease: release });
};

const ITEMS = ["item:ham", "item:veg"];
type Failure = { afterCommit?: () => Promise<void> };
let seq = 0; // the shared in-memory repository keeps idempotency receipts across tests, so command IDs must be unique
async function harness() {
  store.records.clear(); store.failWith = undefined; resetCpuOutboxForTests();
  const plans = createProductionPlanRepository();
  const orders = new Map<string, O>();
  const emitted: Array<{ orderId: string; changeType: string; sequence: number }> = [];
  const failure: Failure = {};
  const hid = `h${++seq}`;
  // The shared in-memory repository keeps idempotency receipts for the whole process; salt keys so tests stay isolated.
  const salt = (change: never) => ({ ...(change as object), ...((change as { idempotencyKey?: string }).idempotencyKey ? { idempotencyKey: `${hid}:${(change as { idempotencyKey: string }).idempotencyKey}` } : {}) }) as never;
  const wrapped = {
    ...plans,
    get: (id: string) => plans.get(id), getByOrderIds: (x: string[]) => plans.getByOrderIds(x), save: (p: ProductionPlan, e?: string) => plans.save(p, e),
    saveAndAppendCpuChange: async (p: ProductionPlan, e: string | undefined, change: never) => { const r = await plans.saveAndAppendCpuChange(p, e, salt(change)); if (!r.duplicate && failure.afterCommit) { const f = failure.afterCommit; failure.afterCommit = undefined; await f(); } return r; },
  };
  const deps = { plans: wrapped, store, loadOrder: async (id: string) => orders.get(id), emit: async (input: { order: { canonicalId: string }; changeType: string; sequence: number }) => { emitted.push({ orderId: input.order.canonicalId, changeType: input.changeType, sequence: input.sequence }); }, now: undefined as undefined | (() => string) };
  const originOrder = order("o-origin", ITEMS); orders.set("o-origin", originOrder);
  const originPlan = signedPlan(originOrder, "rel-origin-1", { "item:ham": { milk: "contains" } });
  await plans.save(originPlan);
  await recordSignedApproval({ store }, originPlan, originOrder as never, AT, "chef");
  const compositionId = compositionIdentity(originOrder as never)!.compositionId;
  const add = async (id: string, items = ITEMS, lineExtra: Record<string, unknown> = {}) => { const o = order(id, items, {}, lineExtra); orders.set(id, o); const p = blank(planFor(o)); await plans.save(p); return { o, p }; };
  const adopt = async (id: string, commandId = `reuse-${id}-${++seq}-command`) => {
    const { o, p } = await add(id);
    const r = await applyReuseCommand(deps as never, { plan: structuredClone(p), storedPlan: p, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId });
    return { o, p, r, commandId };
  };
  const revoke = (releaseId = "rel-origin-1", overrides: Partial<{ compositionId: string }> = {}) => cascadeAuthorityRevocation(deps as never, { compositionId: overrides.compositionId ?? compositionId, releaseId, actor: "head", actorId: "u2", at: "2026-10-12T13:00:00.000Z", reason: "corrected" });
  return { plans, salt, orders, deps, emitted, failure, originOrder, originPlan, compositionId, add, adopt, revoke };
}
type H = Awaited<ReturnType<typeof harness>>;
const readyArtifact = { id: "a", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "c".repeat(64), pdfStatus: "generated", driveStatus: "saved", driveFileId: "f" } as never;
async function makeReady(h: H, orderId: string) {
  const stored = (await h.plans.get(orderId))!;
  const ready: ProductionPlan = { ...stored, matrixArtifact: readyArtifact, currentAllergenRelease: materializeCpuAllergenRelease(stored.currentAllergenRelease!, { masterArtifact: readyArtifact, derivedArtifacts: [readyArtifact], packetArtifacts: [] }), updatedAt: "2026-10-12T11:05:00.000Z" };
  await h.plans.save(ready);
  return ready;
}
const authorityOf = () => [...store.records.values()][0];

test("end to end: signed origin → authority → generation-bound reuse release → origin correction → adopter non-authoritative and invalidated", async () => {
  const h = await harness();
  const originBefore = JSON.stringify(await h.plans.get("o-origin"));
  assert.equal(authorityOf().generation, 1);
  const { o, r, commandId } = await h.adopt("o-other");
  assert.equal(r.changed, true);
  const stored = (await h.plans.get("o-other"))!;
  const release = stored.currentAllergenRelease!;
  assert.equal(release.approvalMode, "reused_authority");
  assert.equal(release.status, "pending");
  assert.deepEqual(release.signatures, []);
  assert.equal(release.sourceBookingId, "booking:o-other");
  assert.equal(release.reusedAuthority?.generation, 1);
  assert.equal(release.reusedAuthority?.origin.releaseId, "rel-origin-1");
  assert.equal(stored.reusedAllergenAuthority?.generation, 1);
  assert.equal(stored.status, "planned");
  assert.deepEqual(stored.menuItems.map(i => i.sourceLineId).sort(), ["o-other:0", "o-other:1"]);
  assert.equal(h.emitted.filter(e => e.orderId === "o-other" && e.changeType === "apply-reused-authority").length, 1);
  assert.ok(listCpuOutboxForTests().some(event => event.payload.route === "/api/internal/cpu-release-materialize" && event.payload.body.orderId === "o-other"), "release materialization obligation is committed");
  assert.equal(authorityOf().reusedBy.find(item => item.orderId === "o-other")?.state, "committed");

  const ready = await makeReady(h, "o-other");
  assert.equal(reusedAuthorityReleaseMatchesOrder(ready.currentAllergenRelease, o as never, ready.menuItems), true);
  assert.equal(currentAllergenReleaseMatchesOrder(ready.currentAllergenRelease, o as never, ready.menuItems), false, "a reused release must never satisfy the signed-release test");
  assert.equal((await reuseViewFor(store, ready, o as never))?.applied?.valid, true);
  assert.equal((await guardReusedPlan(store, ready, o as never)).currentAllergenRelease?.approvalMode, "reused_authority");

  const replay = await applyReuseCommand(h.deps as never, { plan: structuredClone(ready), storedPlan: ready, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T12:00:00.000Z", commandId });
  assert.equal(replay.changed, false);
  assert.equal(h.emitted.filter(e => e.orderId === "o-other").length, 1);
  assert.equal(authorityOf().reusedBy.filter(item => item.orderId === "o-other").length, 1);

  h.emitted.length = 0;
  assert.deepEqual(await h.revoke(), ["o-other"]);
  const after = (await h.plans.get("o-other"))!;
  assert.equal(after.currentAllergenRelease, undefined);
  assert.equal(after.reusedAllergenAuthority, undefined);
  assert.equal(after.matrixArtifact, undefined);
  assert.notEqual(after.status, "planned");
  assert.equal(after.allergenReleaseHistory?.at(-1)?.status, "revoked");
  assert.equal(hasAllergenAuthority(after), false);
  assert.deepEqual(h.emitted.map(e => [e.orderId, e.changeType]), [["o-other", "allergen-authority-revoked"]]);
  assert.ok(h.emitted[0].sequence > 0);
  assert.equal(await reuseViewFor(store, after, o as never), undefined);
  assert.deepEqual(await reuseCandidateFor(store, after, o as never), { available: false, reason: "authority_revoked" });
  h.emitted.length = 0;
  assert.deepEqual(await h.revoke(), ["o-other"], "a repeated revocation is reported again so durable work is re-ensured");
  assert.equal(h.emitted.length, 0, "…but re-emits nothing");
  assert.equal(JSON.stringify(await h.plans.get("o-origin")), originBefore);
});

test("a commercial amendment (quantity, date, customer, headcount) keeps the authority; an allergen change revokes it", async () => {
  const h = await harness();
  const amended = order("o-origin", ITEMS, { serviceDate: "2026-10-27", clientName: "Another customer", version: 2, currentRevision: 2 });
  (amended.lines as never as Array<{ customerQuantity: number }>).forEach(line => { line.customerQuantity = 99; });
  const after = structuredClone(h.originPlan);
  for (const item of after.menuItems) for (const sub of item.subItems) { sub.quantity = 99; sub.name = `${sub.name} (renamed)`; }
  assert.equal(approvedMatrixChanged(h.originPlan, after, amended as never), false);
  const edited = structuredClone(h.originPlan); edited.menuItems[0].subItems[0].allergens.eggs = "contains" as never;
  assert.equal(approvedMatrixChanged(h.originPlan, edited, h.originOrder as never), true);
  const replacement = order("o-origin-v2", ITEMS);
  assert.equal((await reuseCandidateFor(store, planFor(replacement, {}, { status: "planning" }), replacement as never)).available, true);
});

test("historical records without a composition identity fall back to fresh review and cannot adopt", async () => {
  const h = await harness();
  const legacy = order("o-legacy", ITEMS); (legacy.lines as never as Array<{ sourceMenuItemId?: string }>).forEach(line => { delete line.sourceMenuItemId; });
  await h.plans.save(planFor(legacy, {}, { status: "planning" }));
  assert.deepEqual(await reuseCandidateFor(store, planFor(legacy), legacy as never), { available: false, reason: "composition_unavailable" });
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: planFor(legacy), order: legacy as never, actor: "a", actorId: "u", at: AT }), /no canonical sandwich composition/);
});

test("durable cascade: a failure part-way through the adopters is retried from the outbox; every adopter ends non-authoritative exactly once", async () => {
  const h = await harness();
  const ids = ["o-a", "o-b", "o-c"];
  for (const id of ids) assert.equal((await h.adopt(id)).r.changed, true);
  const commits = new Map<string, number>();
  const emitSuccess = new Map<string, number>();
  const failures = { emitB: 1, commitC: 1 };
  const plans = {
    ...h.plans, get: (id: string) => h.plans.get(id), getByOrderIds: (x: string[]) => h.plans.getByOrderIds(x), save: (p: ProductionPlan, e?: string) => h.plans.save(p, e),
    saveAndAppendCpuChange: async (p: ProductionPlan, e: string | undefined, change: never) => {
      if (p.orderId === "o-c" && failures.commitC-- > 0) throw new Error("injected commit failure for o-c");
      const result = await h.plans.saveAndAppendCpuChange(p, e, h.salt(change));
      if (!result.duplicate) commits.set(p.orderId, (commits.get(p.orderId) || 0) + 1);
      return result;
    },
  };
  const deps = {
    plans, store, loadOrder: async (id: string) => h.orders.get(id),
    emit: async (input: { order: { canonicalId: string } }) => {
      if (input.order.canonicalId === "o-b" && failures.emitB-- > 0) throw new Error("injected invalidation failure for o-b");
      emitSuccess.set(input.order.canonicalId, (emitSuccess.get(input.order.canonicalId) || 0) + 1);
    },
  };
  const reopened = await cascadeAuthorityRevocation(deps as never, { compositionId: h.compositionId, releaseId: "rel-origin-1", actor: "head", actorId: "u2", at: "2026-10-12T13:00:00.000Z", reason: "corrected" });
  assert.equal(reopened.length, 3);
  const authority = authorityOf();
  assert.equal(authority.status, "revoked", "origin revocation is immediate");
  assert.ok(authority.revocation, "revocation intent is recorded atomically with the status");
  const queued = listCpuOutboxForTests().find(event => event.eventId === authorityRevocationEventId(h.compositionId, 1));
  assert.ok(queued && queued.payload.route === AUTHORITY_REVOKED_ROUTE, "adopter cascade is durable outbox work");
  const progress = authority.cascades["1"];
  assert.equal(progress?.completedAt, undefined);
  assert.equal(progress?.adopters["o-a"]?.done, true);
  assert.notEqual(progress?.adopters["o-b"]?.done, true);
  assert.notEqual(progress?.adopters["o-c"]?.done, true);
  assert.equal(authority.cascadePending, true);
  for (const id of ids) {
    const view = await guardReusedPlan(store, (await h.plans.get(id))!, h.orders.get(id) as never);
    assert.equal(view.currentAllergenRelease, undefined, `${id} read exposes no authoritative release`);
    assert.notEqual(view.status, "planned");
  }
  const body = queued!.payload.body as never as Parameters<typeof processAuthorityRevocation>[1];
  assert.equal((await processAuthorityRevocation(deps as never, body)).status, "complete");
  assert.equal((await processAuthorityRevocation(deps as never, body)).status, "complete");
  for (const id of ids) {
    const after = (await h.plans.get(id))!;
    assert.equal(after.currentAllergenRelease, undefined);
    assert.equal(after.reusedAllergenAuthority, undefined);
    assert.equal(after.allergenReleaseHistory?.filter(release => release.status === "revoked").length, 1, `${id} release revoked exactly once`);
    assert.equal(commits.get(id), 1, `${id} CPU revocation change committed exactly once`);
    assert.ok((emitSuccess.get(id) || 0) >= 1);
  }
  assert.equal(emitSuccess.get("o-a"), 1);
  assert.equal(emitSuccess.get("o-c"), 1);
  const done = authorityOf();
  assert.ok(done.cascades["1"].completedAt);
  assert.equal(done.cascadePending, false);
  assert.equal(done.history.filter(entry => entry.action === "cascade-completed").length, 1);
});

// ---------------------------------------------------------------- adversarial: each Sol finding must now fail safe

test("FINDING 1: every read path re-validates the shared authority (list, selected, download, projection loader, materialization)", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  // The origin approval is revoked but NO cascade has run yet (worst case: durable work not delivered).
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  const stale = (await h.plans.get("o-other"))!;
  assert.equal(stale.currentAllergenRelease?.approvalMode, "reused_authority", "the durable plan is still stale");
  for (const view of [await guardReusedPlan(store, stale, o as never), (await loadGuardedPlansForOrders([o as never], ids => h.plans.getByOrderIds(ids)))[0]]) {
    assert.equal(view.currentAllergenRelease, undefined);
    assert.equal(view.matrixArtifact, undefined);
    assert.equal(view.siteMatrixArtifacts, undefined);
    assert.notEqual(view.status, "planned");
  }
  assert.equal((await reuseViewFor(store, ready, o as never))?.applied?.valid, false);
  await assert.rejects(assertReusedApprovalValid(store, stale, o as never), /no longer valid/);
  // A release marked reused with its provenance stripped is still treated as invalid.
  const tampered = { ...stale, reusedAllergenAuthority: undefined };
  assert.equal((await guardReusedPlan(store, tampered, o as never)).currentAllergenRelease, undefined);
  // A release bound to a different generation than the plan provenance is invalid even against an active authority.
  await store.mutate(h.compositionId, current => ({ ...current, status: "active" as const, revocation: undefined }));
  const mismatched = structuredClone(stale); mismatched.currentAllergenRelease!.reusedAuthority!.generation = 7;
  assert.equal((await validateReusedApproval(store, mismatched, o as never)).valid, false);
  // Review-status style readers only trust signed releases, so a reused release can never read as signed/ready.
  assert.equal(currentAllergenReleaseMatchesOrder(ready.currentAllergenRelease, o as never, ready.menuItems), false);
});

test("FINDING 2: an authority-store failure fails closed everywhere and is never swallowed into authoritative data", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  store.failWith = new Error("firestore unavailable");
  try {
    assert.equal((await guardReusedPlan(store, ready, o as never)).currentAllergenRelease, undefined);
    assert.notEqual((await guardReusedPlan(store, ready, o as never)).status, "planned");
    assert.deepEqual(await validateReusedApproval(store, ready, o as never), { valid: false, reason: "authority_lookup_failed" });
    const view = await reuseViewFor(store, ready, o as never);
    assert.equal(view?.applied?.valid, false);
    assert.deepEqual(await reuseCandidateFor(store, planFor(o, {}, { status: "planning" }), o as never), { available: false, reason: "authority_lookup_failed" });
    await assert.rejects(assertReusedApprovalValid(store, ready, o as never), /no longer valid/);
    await assert.rejects(reconcileReuse(store, structuredClone(ready), o as never, { by: "a", at: AT }), /firestore unavailable/, "a mutation aborts rather than keeping or dropping the approval blindly");
    assert.equal((await loadGuardedPlansForOrders([o as never], ids => h.plans.getByOrderIds(ids)))[0].currentAllergenRelease, undefined);
  } finally { store.failWith = undefined; }
  assert.equal((await guardReusedPlan(store, ready, o as never)).currentAllergenRelease?.approvalMode, "reused_authority", "valid again once the store recovers");
});

test("FINDING 3: adoption cannot commit behind a revocation or a completed cascade", async () => {
  // (a) revoked before adoption
  let h = await harness();
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  const late = await h.add("o-late");
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(late.p), storedPlan: late.p, order: late.o as never, actor: "cpu", actorId: "u", at: AT }), /cannot be reused|no longer available/);
  assert.equal((await h.plans.get("o-late"))!.currentAllergenRelease, undefined);

  // (b) revoked between the plan commit and the finalize compare-and-set
  h = await harness();
  const racer = await h.add("o-race");
  h.failure.afterCommit = async () => { await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); };
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(racer.p), storedPlan: racer.p, order: racer.o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-race-${++seq}-command` }), (error: { code?: string }) => error.code === "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED");
  const raced = (await h.plans.get("o-race"))!;
  assert.equal(raced.currentAllergenRelease, undefined, "the adopter was compensated, not left authoritative");
  assert.equal(raced.reusedAllergenAuthority, undefined);
  assert.notEqual(raced.status, "planned");

  // (c) a live reservation holds the cascade open; completion only after it finalizes/expires
  h = await harness();
  await h.add("o-reserving");
  const reserved = await store.beginAdoption(h.compositionId, { generation: 1, releaseId: "rel-origin-1", matrixSemanticHash: authorityOf().matrixSemanticHash }, "o-reserving", AT, "u", "2099-01-01T00:00:00.000Z");
  assert.equal(reserved.ok, true);
  await h.revoke();
  assert.equal(authorityOf().cascades["1"]?.completedAt, undefined, "cascade stays open while a reservation is live");
  assert.equal(await store.finalizeAdoption(h.compositionId, 1, "o-reserving", AT), false, "the reservation cannot finalize after revocation");
  h.deps.now = () => "2100-01-01T00:00:00.000Z"; // lease expired
  const work = listCpuOutboxForTests().find(event => event.eventId === authorityRevocationEventId(h.compositionId, 1))!.payload.body as never as Parameters<typeof processAuthorityRevocation>[1];
  assert.equal((await processAuthorityRevocation(h.deps as never, work)).status, "complete");
  assert.ok(authorityOf().cascades["1"].completedAt);

  // (d) once the cascade is complete nobody can adopt
  const afterDone = await h.add("o-after");
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(afterDone.p), storedPlan: afterDone.p, order: afterDone.o as never, actor: "cpu", actorId: "u", at: AT }), /cannot be reused|no longer available/);
});

test("FINDING 4: revocation intent and cascade work cannot be orphaned (lost enqueue, retry, conflicting approval, reconciliation)", async () => {
  // (a) the durable work is lost after the revocation; retrying the revocation re-ensures it
  let h = await harness();
  await h.adopt("o-other");
  await h.revoke();
  resetCpuOutboxForTests();
  assert.equal(listCpuOutboxForTests().length, 0);
  await h.revoke();
  assert.ok(listCpuOutboxForTests().some(event => event.eventId === authorityRevocationEventId(h.compositionId, 1)), "retrying an already-revoked authority re-ensures the durable work");

  // (b) a conflicting signed approval uses the same durable path
  h = await harness();
  await h.adopt("o-other");
  const rival = order("o-rival", ITEMS); h.orders.set("o-rival", rival);
  const conflict = await recordSignedApproval({ store }, signedPlan(rival, "rel-rival-1", { "item:ham": { eggs: "contains" } }), rival as never, AT, "chef");
  assert.equal(conflict?.change, "revoked_conflict");
  assert.equal(authorityOf().status, "revoked"); assert.equal(authorityOf().cascadePending, true);
  assert.ok(listCpuOutboxForTests().some(event => event.eventId === authorityRevocationEventId(h.compositionId, 1)), "conflict revocation schedules durable cascade work");

  // (c) reconciliation reconstructs missing work from revoked authorities alone
  h = await harness();
  await h.adopt("o-other");
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); // crash before any work was enqueued
  resetCpuOutboxForTests();
  const results = await reconcileAuthorityCascades(h.deps as never);
  assert.deepEqual(results.map(r => r.status), ["complete"]);
  assert.equal((await h.plans.get("o-other"))!.currentAllergenRelease, undefined);
  assert.equal(authorityOf().cascadePending, false);
  assert.equal((await reconcileAuthorityCascades(h.deps as never)).length, 0, "nothing left to reconcile");
});

test("FINDING 5: re-approval is a new generation; adopters of an earlier generation never become valid against it", async () => {
  const h = await harness();
  const { o: oldAdopter } = await h.adopt("o-old");
  await makeReady(h, "o-old");
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); // cascade intentionally not run yet
  const reapproved = order("o-reapproved", ITEMS); h.orders.set("o-reapproved", reapproved);
  const outcome = await recordSignedApproval({ store }, signedPlan(reapproved, "rel-reapproved-1", { "item:ham": { milk: "contains" } }), reapproved as never, AT, "chef");
  assert.equal(outcome?.change, "reactivated");
  assert.equal(authorityOf().generation, 2); assert.equal(authorityOf().status, "active");
  // The old adopter shares the composition, the matrix and even the same active authority record — and is still invalid.
  const oldPlan = (await h.plans.get("o-old"))!;
  assert.deepEqual(await validateReusedApproval(store, oldPlan, oldAdopter as never), { valid: false, reason: "generation_mismatch" });
  assert.equal((await guardReusedPlan(store, oldPlan, oldAdopter as never)).currentAllergenRelease, undefined);
  assert.equal((await reuseViewFor(store, oldPlan, oldAdopter as never))?.applied?.valid, false);
  // A new adopter binds to generation 2 and is valid; the generation-1 cascade reopens only the generation-1 adopter.
  const fresh = await h.adopt("o-new");
  assert.equal((await h.plans.get("o-new"))!.reusedAllergenAuthority?.generation, 2);
  await makeReady(h, "o-new");
  assert.equal((await validateReusedApproval(store, (await h.plans.get("o-new"))!, fresh.o as never)).valid, true);
  const gen1Work = { compositionId: h.compositionId, generation: 1, releaseId: "rel-origin-1", actor: "head", actorId: "u2", at: "2026-10-12T13:00:00.000Z", reason: "corrected" };
  assert.equal((await processAuthorityRevocation(h.deps as never, gen1Work)).status, "complete");
  assert.equal((await h.plans.get("o-old"))!.reusedAllergenAuthority, undefined);
  assert.equal((await h.plans.get("o-new"))!.reusedAllergenAuthority?.generation, 2, "the generation-2 adopter is untouched");
  assert.equal((await validateReusedApproval(store, (await h.plans.get("o-new"))!, fresh.o as never)).valid, true);
  assert.equal(authorityOf().cascades["1"].completedAt !== undefined, true);
  assert.equal(authorityOf().cascades["2"], undefined);
});

test("FINDING 6: revocation uses the composition stamped on the signed release, not the origin booking's current composition", async () => {
  const h = await harness();
  await h.adopt("o-other");
  // The origin booking is amended to a different composition before its approval is reopened.
  const amendedOrigin = order("o-origin", [...ITEMS, "item:egg"]);
  const stampedOnRelease = h.originPlan.currentAllergenRelease!.compositionId!;
  assert.equal(stampedOnRelease, h.compositionId);
  assert.notEqual(compositionIdentity(amendedOrigin as never)!.compositionId, stampedOnRelease, "re-deriving from the current order would target the wrong authority");
  assert.deepEqual(await h.revoke("rel-origin-1", { compositionId: stampedOnRelease }), ["o-other"]);
  assert.equal(authorityOf().status, "revoked");
  assert.equal((await h.plans.get("o-other"))!.reusedAllergenAuthority, undefined);
  // A legacy release without the stamp can neither establish nor revoke an authority.
  const legacyOrder = order("o-legacy-signed", ["item:legacy"]);
  assert.equal(await recordSignedApproval({ store }, signedPlan(legacyOrder, "rel-legacy", {}, false), legacyOrder as never, AT, "chef"), undefined);
  assert.deepEqual(await cascadeAuthorityRevocation(h.deps as never, { compositionId: undefined, releaseId: "rel-legacy", actor: "a", actorId: "u", at: AT, reason: "x" }), []);
});

test("FINDING 7: a changed bread instruction or substitution prevents reuse; commercial differences do not", async () => {
  const h = await harness();
  const sourdough = order("o-sourdough", ITEMS, {}, { productionInstructions: "Use sourdough" });
  assert.deepEqual(await reuseCandidateFor(store, planFor(sourdough, {}, { status: "planning" }), sourdough as never), { available: false, reason: "authority_missing" });
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: planFor(sourdough, {}, { status: "planning" }), order: sourdough as never, actor: "a", actorId: "u", at: AT }), /authority_missing/i);
  const conflicting = order("o-conflict", ITEMS, {}, { allergenEvidenceStatus: "conflicting" });
  assert.deepEqual(await reuseCandidateFor(store, planFor(conflicting, {}, { status: "planning" }), conflicting as never), { available: false, reason: "composition_unavailable" });
  const commercial = order("o-commercial", ITEMS, { serviceDate: "2027-02-02", clientName: "Else" });
  (commercial.lines as never as Array<{ customerQuantity: number }>).forEach(line => { line.customerQuantity = 400; });
  assert.equal((await reuseCandidateFor(store, planFor(commercial, {}, { status: "planning" }), commercial as never)).available, true);
});

test("authority storage is server-only: Admin SDK access, no client SDK, deny-all Firestore rules", async () => {
  const source = await readFile(new URL("../lib/allergen-authority-store.ts", import.meta.url), "utf8");
  assert.match(source, /import\("\.\/firebase-admin"\)/);
  assert.doesNotMatch(source, /firebase\/firestore|firebase\/app|from "firebase"/);
  const rules = await readFile(new URL("../../integration-hub/firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
});

test("the route and readers are wired through the one validator and the canonical change path", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /applyReuseCommand\(reuseDeps\(request\)/);
  assert.match(route, /cascadeAuthorityRevocation\(reuseDeps\(request\), \{ compositionId: before\.compositionId/);
  assert.match(route, /emitCpuPlanChange\(request, input\)/);
  assert.match(route, /guardReusedPlan\(allergenAuthorityStore, await mergeOriginalItems/);
  assert.doesNotMatch(route, /reuseViewFor\([^)]*\)\.catch/);
  assert.match(await readFile(new URL("../app/api/internal/cpu-allergen-authority-revoked/route.ts", import.meta.url), "utf8"), /processAuthorityRevocation/);
  assert.match(await readFile(new URL("../app/api/internal/durable-outbox/route.ts", import.meta.url), "utf8"), /reconcileAuthorityCascades/);
  for (const file of ["cpu-projection.ts", "cpu-review-package.ts", "cpu-post-commit-worker.ts"]) assert.match(await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8"), /loadGuardedPlansForOrders/, `${file} reads plans through the guard`);
  assert.match(await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8"), /assertReusedApprovalValid/);
});
