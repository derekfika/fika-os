import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The real memory plan repository, memory authority store and memory outbox are used (no Firestore, no HTTP).
process.env.FIKA_CPU_PLAN_STORE = "memory";
const { createProductionPlanRepository, repositoryTestHooks } = await import("../lib/production-plan-repository");
const { memoryAllergenAuthorityStore } = await import("../lib/allergen-authority-store");
const orchestrator = await import("../lib/allergen-reuse-orchestrator");
const { applyReuseCommand, cascadeAuthorityRevocation, approvedMatrixChanged, processAuthorityRevocation, reconcileAuthorityCascades, recordSignedApproval, originRevocationClause, runCommittedRevocation, ensureCascadeWorkForPendingAuthorities, AUTHORITY_REVOKED_ROUTE, authorityRevocationEventId } = orchestrator;
const service = await import("../lib/allergen-reuse-service");
const { reuseViewFor, reuseCandidateFor, guardReusedPlan, validateReusedApproval, assertReusedApprovalValid, reconcileReuse } = service;
const { loadGuardedPlansForOrders } = await import("../lib/cpu-guarded-plans");
const { revalidateProjectionAuthority } = await import("../lib/cpu-projection-authority");
const { buildCpuDayProjection } = await import("../lib/cpu-projection");
const { loadDeliveredInReviewStatuses } = await import("../lib/delivered-in-review");
const { selectedPlanResponseBody, servicePlansResponseBody, applyReuseResponse, finalApplyResponse } = await import("../lib/cpu-plan-response");
const lineCases = await import("./support/line-association-cases");
const schemeCases = await import("./support/identity-scheme-cases");
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
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", exceptions: [], requirementIds: [], priority: "normal", destinationOplocId: "oploc:test", destinationLabel: "Test site",
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
type Failure = { afterCommit?: () => Promise<void>; emitOnce?: Error };
let seq = 0; // the shared in-memory repository keeps idempotency receipts across tests, so command IDs must be unique
async function harness() {
  store.records.clear(); store.failWith = undefined; repositoryTestHooks.beforeAuthorityCheck = undefined; resetCpuOutboxForTests();
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
    saveAndAppendCpuChange: async (p: ProductionPlan, e: string | undefined, change: never, authority?: never) => { const r = await plans.saveAndAppendCpuChange(p, e, salt(change), authority); if (!r.duplicate && failure.afterCommit) { const f = failure.afterCommit; failure.afterCommit = undefined; await f(); } return r; },
  };
  const deps = { plans: wrapped, store, loadOrder: async (id: string) => orders.get(id), emit: async (input: { order: { canonicalId: string }; changeType: string; sequence: number }) => { if (failure.emitOnce) { const error = failure.emitOnce; failure.emitOnce = undefined; throw error; } emitted.push({ orderId: input.order.canonicalId, changeType: input.changeType, sequence: input.sequence }); }, now: undefined as undefined | (() => string) };
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
const ctxFor = (h: H) => ({ store, loadOrder: async (id: string) => h.orders.get(id) as never });
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
  assert.ok(authorityOf().reusedBy.find(item => item.orderId === "o-other"), "the adoption is registered in the same transaction as the plan");

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
    saveAndAppendCpuChange: async (p: ProductionPlan, e: string | undefined, change: never, authority?: never) => {
      if (p.orderId === "o-c" && failures.commitC-- > 0) throw new Error("injected commit failure for o-c");
      const result = await h.plans.saveAndAppendCpuChange(p, e, h.salt(change), authority);
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

test("FINDING 3 / P1-3: adoption is one transaction; it cannot commit behind a revocation, an expired plan preparation, or a completed cascade", async () => {
  // (a) revoked before adoption
  let h = await harness();
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  const late = await h.add("o-late");
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(late.p), storedPlan: late.p, order: late.o as never, actor: "cpu", actorId: "u", at: AT }), /cannot be reused|no longer available/);
  assert.equal((await h.plans.get("o-late"))!.currentAllergenRelease, undefined);

  // (b) the authority is revoked AFTER the adopter validated but BEFORE the transaction's own check: the commit is refused and nothing is written
  h = await harness();
  const racer = await h.add("o-race");
  const before = JSON.stringify(await h.plans.get("o-race"));
  repositoryTestHooks.beforeAuthorityCheck = async () => { repositoryTestHooks.beforeAuthorityCheck = undefined; await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); };
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(racer.p), storedPlan: racer.p, order: racer.o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-race-${++seq}-command` }), (error: { code?: string }) => error.code === "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED");
  assert.equal(JSON.stringify(await h.plans.get("o-race")), before, "no plan, release or change event was written");
  assert.equal(authorityOf().reusedBy.some(item => item.orderId === "o-race"), false, "no adopter was registered");
  assert.equal(h.emitted.length, 0);

  // (c) reservation-expiry scenario: a slow adopter prepared its plan long ago; the cascade has completed since. The late commit is refused.
  h = await harness();
  const slow = await h.add("o-slow");
  const prepared = structuredClone(slow.p);
  await h.revoke();
  assert.ok(authorityOf().cascades["1"]?.completedAt, "the cascade completed with no adopters");
  h.deps.now = () => "2100-01-01T00:00:00.000Z";
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: prepared, storedPlan: slow.p, order: slow.o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-slow-${++seq}-command` }), /cannot be reused|no longer available/);
  assert.equal((await h.plans.get("o-slow"))!.currentAllergenRelease, undefined);
  assert.equal(authorityOf().reusedBy.length, 0, "the registry stayed final after the cascade completed");

  // (d) once the cascade is complete nobody can adopt, and the repository itself refuses to persist a reused plan for the revoked generation
  const afterDone = await h.add("o-after");
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(afterDone.p), storedPlan: afterDone.p, order: afterDone.o as never, actor: "cpu", actorId: "u", at: AT }), /cannot be reused|no longer available/);
  const forged = structuredClone(afterDone.p); forged.status = "planned"; forged.reusedAllergenAuthority = { authorityId: `${h.compositionId}#g1`, compositionId: h.compositionId, generation: 1, identityVersion: authorityOf().identityVersion, matrixSemanticHash: authorityOf().matrixSemanticHash, adoptedAt: AT, adoptedBy: "x", lineBindings: {}, origin: authorityOf().origin };
  await assert.rejects(h.plans.save(forged), (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID");
  await assert.rejects(h.plans.saveAndAppendCpuChange(forged, undefined, { serviceDate: "2026-10-20", entityType: "productionPlan", entityId: forged.id, revision: 1, changeType: "x", actorId: "u", changedAt: AT } as never), (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID");
});

test("P1-3: a crash after the adoption commit leaves a complete, valid adoption; retry resolves it, and a later revocation reopens it with no other mutation", async () => {
  const h = await harness();
  const { o, p } = await h.add("o-crash");
  h.failure.emitOnce = new Error("process died after commit");
  const commandId = `reuse-crash-${++seq}-command`;
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: structuredClone(p), storedPlan: p, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId }), /process died after commit/);
  // The commit was atomic: plan, release and registry entry all exist together (there is nothing "pending" to strand).
  const stored = (await h.plans.get("o-crash"))!;
  assert.equal(stored.currentAllergenRelease?.approvalMode, "reused_authority");
  assert.equal(authorityOf().reusedBy.filter(item => item.orderId === "o-crash").length, 1);
  assert.equal((await validateReusedApproval(store, stored, o as never)).valid, true);
  // Retry resolves the same adoption; it neither errors nor duplicates anything.
  const retry = await applyReuseCommand(h.deps as never, { plan: structuredClone(stored), storedPlan: stored, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T12:00:00.000Z", commandId });
  assert.equal(retry.changed, false);
  assert.equal(authorityOf().reusedBy.filter(item => item.orderId === "o-crash").length, 1);
  // A plan carrying provenance whose registry entry is missing is not treated as adopted: retry (new command) re-registers atomically.
  await store.mutate(h.compositionId, current => ({ ...current, reusedBy: [] }));
  assert.equal((await validateReusedApproval(store, stored, o as never)).valid, false);
  const repaired = await applyReuseCommand(h.deps as never, { plan: structuredClone(stored), storedPlan: stored, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T12:30:00.000Z", commandId: `reuse-crash-repair-${++seq}-command` });
  assert.equal(repaired.changed, true);
  assert.equal(authorityOf().reusedBy.filter(item => item.orderId === "o-crash").length, 1);
  // The crashed adopter is deterministically classified by the next revocation: reopened by the durable cascade alone.
  await h.revoke();
  const after = (await h.plans.get("o-crash"))!;
  assert.equal(after.currentAllergenRelease, undefined); assert.equal(after.reusedAllergenAuthority, undefined);
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
  assert.match(route, /runCommittedRevocation\(reuseDeps\(request\), input\.clause\)/);
  assert.match(route, /originRevocationClause\(/);
  assert.match(route, /emitCpuPlanChange\(request, input\)/);
  assert.match(route, /guardReusedPlan\(allergenAuthorityStore, await mergeOriginalItems/);
  assert.doesNotMatch(route, /reuseViewFor\([^)]*\)\.catch/);
  assert.match(await readFile(new URL("../app/api/internal/cpu-allergen-authority-revoked/route.ts", import.meta.url), "utf8"), /processAuthorityRevocation/);
  assert.match(await readFile(new URL("../app/api/internal/durable-outbox/route.ts", import.meta.url), "utf8"), /reconcileAuthorityCascades/);
  for (const file of ["cpu-projection.ts", "cpu-review-package.ts", "cpu-post-commit-worker.ts"]) assert.match(await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8"), /loadGuardedPlansForOrders/, `${file} reads plans through the guard`);
  assert.match(await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8"), /assertReusedApprovalValid/);
});

test("P1-1: selected plan, plans[] and notifications fail closed; review/matrix status never reports a stale reused plan as ready", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  await makeReady(h, "o-other");
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); // no cascade yet
  const stored = (await h.plans.get("o-other"))!;
  // selected plan and plans[] both go through guardReusedPlan
  const selected = await guardReusedPlan(store, stored, o as never);
  const list = await Promise.all([stored].map(plan => guardReusedPlan(store, plan, o as never)));
  for (const plan of [selected, ...list]) { assert.notEqual(plan.status, "planned"); assert.equal(plan.currentAllergenRelease, undefined); assert.equal(plan.matrixArtifact, undefined); }
  assert.equal(list.filter(plan => plan.status === "planned").length, 0, "no readiness notification can be derived from the guarded list");
  // review / matrix status
  const statuses = await loadDeliveredInReviewStatuses({ orderIds: ["o-other"], repository: { get: id => h.plans.get(id) }, loadOrder: async id => h.orders.get(id) as never, includeMatrix: true });
  assert.equal(statuses.length, 1);
  const status = statuses[0] as unknown as Record<string, unknown>;
  assert.notEqual(status.planStatus, "planned"); assert.notEqual(status.reviewed, true);
  assert.deepEqual(status.signatureRoles, []);
  assert.equal(status.matrixArtifact, undefined);
  // and a store outage fails closed on the same paths
  store.failWith = new Error("down");
  try {
    const outage = await loadDeliveredInReviewStatuses({ orderIds: ["o-other"], repository: { get: id => h.plans.get(id) }, loadOrder: async id => h.orders.get(id) as never, includeMatrix: true });
    assert.notEqual((outage[0] as unknown as Record<string, unknown>).planStatus, "planned");
  } finally { store.failWith = undefined; }
});

test("P1-1: a cached production projection cannot stay planned/ready after revocation, re-approval or an authority outage", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  const projection = buildCpuDayProjection("2026-10-20", [o as never], [ready]);
  const entry = projection.orders[0];
  assert.equal(entry.workflowStatus, "planned");
  assert.equal(entry.reusedAuthority?.generation, 1, "the cached projection records the authority generation it relies on");
  assert.equal(projection.summary.planned, 1);
  const stillValid = await revalidateProjectionAuthority(projection, ctxFor(h));
  assert.equal(stillValid.orders[0].workflowStatus, "planned");
  // revocation, with NO cascade and NO rebuild: the cached copy is still downgraded on read
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  const revoked = await revalidateProjectionAuthority(projection, ctxFor(h));
  assert.notEqual(revoked.orders[0].workflowStatus, "planned"); assert.equal(revoked.orders[0].reusedAuthorityInvalid, true); assert.equal(revoked.orders[0].reusedAuthority, undefined);
  assert.equal(revoked.summary.planned, 0); assert.ok(revoked.orders[0].attention.length > 0);
  // re-approval is a new generation: the cached generation-1 projection stays invalid
  const reapproved = order("o-reapproved", ITEMS); h.orders.set("o-reapproved", reapproved);
  await recordSignedApproval({ store }, signedPlan(reapproved, "rel-reapproved-1", { "item:ham": { milk: "contains" } }), reapproved as never, AT, "chef");
  assert.equal(authorityOf().status, "active");
  assert.notEqual((await revalidateProjectionAuthority(projection, ctxFor(h))).orders[0].workflowStatus, "planned");
  // an unreadable authority fails closed
  store.failWith = new Error("down");
  try { assert.notEqual((await revalidateProjectionAuthority(projection, ctxFor(h))).orders[0].workflowStatus, "planned"); } finally { store.failWith = undefined; }
  // projections without reused entries cost nothing and are returned untouched
  const plain = buildCpuDayProjection("2026-10-20", [h.originOrder as never], [h.originPlan]);
  assert.equal(await revalidateProjectionAuthority(plain, ctxFor(h)), plain);
});

test("P1-2: materialization cannot promote, return or restore a revoked reused release", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const pending = (await h.plans.get("o-other"))!;
  const promoted: ProductionPlan = { ...pending, matrixArtifact: readyArtifact, currentAllergenRelease: materializeCpuAllergenRelease(pending.currentAllergenRelease!, { masterArtifact: readyArtifact, derivedArtifacts: [readyArtifact], packetArtifacts: [] }), updatedAt: "2026-10-12T11:05:00.000Z" };
  // (a) revocation lands between the materializer's final validation and its commit
  await assertReusedApprovalValid(store, pending, o as never); // final validation passes
  repositoryTestHooks.beforeAuthorityCheck = async () => { repositoryTestHooks.beforeAuthorityCheck = undefined; await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected"); };
  await assert.rejects(h.plans.saveAndAppendCpuChange(promoted, pending.updatedAt, { serviceDate: "2026-10-20", entityType: "productionPlan", entityId: promoted.id, revision: 99, changeType: "allergen-matrix-materialized", actorId: "u", changedAt: AT, idempotencyKey: `promote-${++seq}` } as never), (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID");
  const stored = (await h.plans.get("o-other"))!;
  assert.equal(stored.currentAllergenRelease?.status, "pending", "the release was not promoted to current");
  assert.equal(stored.matrixArtifact, undefined);
  // (b) the already-materialized shortcut re-validates before reporting success
  await assert.rejects(assertReusedApprovalValid(store, promoted, o as never), /no longer valid/);
  const source = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("assertReusedApprovalValid(createAllergenAuthorityStore(), stored") < source.indexOf("return { plan: stored, alreadyMaterialized: true }"), "validity is checked before the already-materialized shortcut returns");
  // (c) recovery/failure handling never restores or re-marks a reused release whose authority is invalid
  const restored = structuredClone(stored); restored.currentAllergenRelease = { ...restored.currentAllergenRelease!, materializationStatus: "failed" };
  await assert.rejects(h.plans.save(restored), (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID");
  assert.match(source, /CPU_REUSED_AUTHORITY_INVALID[\s\S]{0,260}throw error/);
});

test("P1-2: recovery after the cascade already removed the adopter cannot resurrect the reused release", async () => {
  const h = await harness();
  await h.adopt("o-other");
  const staleSnapshot = (await h.plans.get("o-other"))!; // what a slow materializer is holding
  await h.revoke();
  const reopened = (await h.plans.get("o-other"))!;
  assert.equal(reopened.currentAllergenRelease, undefined);
  const resurrected: ProductionPlan = { ...staleSnapshot, updatedAt: "2026-10-12T14:00:00.000Z" };
  await assert.rejects(h.plans.save(resurrected, undefined), (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID");
  await assert.rejects(h.plans.save(resurrected, staleSnapshot.updatedAt), (error: Error) => /changed elsewhere|REUSED_AUTHORITY_INVALID|not valid/.test(error.message));
  assert.equal((await h.plans.get("o-other"))!.currentAllergenRelease, undefined);
});

test("P1-4: the origin mutation and the shared revocation are one transaction; a failed follow-up leaves a revoked authority that the worker repairs", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  await makeReady(h, "o-other");
  // (a) origin transition: reopen the signed review. The revocation rides in the same repository transaction.
  const reopened = structuredClone(h.originPlan); reopened.currentAllergenRelease = { ...reopened.currentAllergenRelease!, status: "revoked" } as never; reopened.signatures = undefined; reopened.signedSignatures = undefined; reopened.status = "planning";
  const clause = originRevocationClause({ before: h.originPlan.currentAllergenRelease, beforePlan: h.originPlan, plan: { ...reopened, currentAllergenRelease: undefined }, order: h.originOrder as never, actor: "head", at: "2026-10-12T13:00:00.000Z", explicitReopen: true });
  assert.ok(clause?.revoke);
  // a failed origin write (stale version) must NOT revoke the authority: both roll back together
  await assert.rejects(h.plans.saveAndAppendCpuChange({ ...reopened, currentAllergenRelease: undefined }, "stale-version", { serviceDate: "2026-10-20", entityType: "productionPlan", entityId: reopened.id, revision: 7, changeType: "reopen-review", actorId: "u", changedAt: AT } as never, clause), /changed elsewhere/);
  assert.equal(authorityOf().status, "active", "no revocation without the origin change");
  const committed = await h.plans.saveAndAppendCpuChange({ ...reopened, currentAllergenRelease: undefined }, h.originPlan.updatedAt, { serviceDate: "2026-10-20", entityType: "productionPlan", entityId: reopened.id, revision: 8, changeType: "reopen-review", actorId: "u", changedAt: AT, idempotencyKey: `origin-reopen-${++seq}` } as never, clause);
  assert.ok(committed.sequence > 0);
  assert.equal(authorityOf().status, "revoked", "the authority is revoked the instant the origin change commits");
  assert.equal(authorityOf().cascadePending, true);
  // reads of the adopter already fail closed, with no follow-up having run
  assert.equal((await guardReusedPlan(store, (await h.plans.get("o-other"))!, o as never)).currentAllergenRelease, undefined);
  // (b) the follow-up (enqueue / cascade) fails after the commit
  resetCpuOutboxForTests();
  store.failWith = new Error("authority store unavailable after origin commit");
  await runCommittedRevocation(h.deps as never, clause).catch(() => undefined);
  store.failWith = undefined;
  assert.equal(listCpuOutboxForTests().length, 0, "no cascade work exists");
  assert.equal(authorityOf().status, "revoked", "…yet the authority is not left active");
  assert.equal((await h.plans.get("o-other"))!.reusedAllergenAuthority !== undefined, true, "the adopter is still durably stale");
  // (c) the normal worker step reconstructs the missing work from the durable revocation intent, and the outbox delivery completes it
  assert.equal(await ensureCascadeWorkForPendingAuthorities(store), 1);
  const queued = listCpuOutboxForTests().find(event => event.eventId === authorityRevocationEventId(h.compositionId, 1))!;
  assert.ok(queued && queued.payload.route === AUTHORITY_REVOKED_ROUTE);
  assert.equal(await ensureCascadeWorkForPendingAuthorities(store), 1, "the sweep is idempotent");
  assert.equal(listCpuOutboxForTests().filter(event => event.eventId === authorityRevocationEventId(h.compositionId, 1)).length, 1);
  assert.equal((await processAuthorityRevocation(h.deps as never, queued.payload.body as never)).status, "complete");
  const after = (await h.plans.get("o-other"))!;
  assert.equal(after.currentAllergenRelease, undefined); assert.equal(after.reusedAllergenAuthority, undefined);
  assert.equal(authorityOf().cascadePending, false);
  assert.equal(await ensureCascadeWorkForPendingAuthorities(store), 0);
});

test("the long-lived worker runs the authority reconciliation; the persistence invariant covers every plan writer", async () => {
  const worker = await readFile(new URL("../scripts/cpu-durable-outbox-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /ensureCascadeWorkForPendingAuthorities\(createAllergenAuthorityStore\(\)\)/);
  assert.match(worker, /CPU_ALLERGEN_AUTHORITY_SWEEP_MS/);
  const repo = await readFile(new URL("../lib/production-plan-repository.ts", import.meta.url), "utf8");
  assert.equal((repo.match(/evaluateAuthorityTransition\(/g) || []).length, 3, "memory save + Firestore save + Firestore save-and-append all evaluate the authority inside their transaction");
  assert.match(repo, /readAuthorities\(db, transaction, plan, authority, current\)/);
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/originRevocationClause\(/g) || []).length, 3, "all three origin transition sites carry the revocation clause");
  assert.match(route, /\}, authorityClause\)/);
});

// ================================================================ round 3: response construction, projection composition, persistence invariants

test("P1-1: the selected GET builds plan, plans[], notifications and menus from ONE guarded plan (also during an authority outage)", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  const valid = await selectedPlanResponseBody(store, { plan: ready, order: o as never, matrixStatus: "ready" });
  assert.equal(valid.plan?.status, "planned");
  assert.equal(valid.plans[0]?.currentAllergenRelease?.approvalMode, "reused_authority");
  assert.equal(valid.notifications.length, 1, "positive control: a valid reused plan notifies");
  assert.equal(valid.approvedMatrixAvailable, true);
  const assertDowngraded = (body: Awaited<ReturnType<typeof selectedPlanResponseBody>>) => {
    for (const plan of [body.plan, ...body.plans]) {
      assert.notEqual(plan?.status, "planned");
      assert.equal(plan?.currentAllergenRelease, undefined, "no reused release in plan or plans[]");
      assert.equal(plan?.matrixArtifact, undefined);
      assert.ok(plan?.menuItems.every(item => item.subItems.every(sub => sub.evidenceStatus !== "completed")), "copied states are not read as reviewed");
    }
    assert.equal(body.plans.length, 1);
    assert.deepEqual(body.notifications, [], "no planned notification is emitted");
    assert.deepEqual(body.menus, []);
    assert.equal(body.approvedMatrixAvailable, false);
    assert.equal(body.matrixStatus, undefined);
  };
  // revoked, cascade not run
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  assertDowngraded(await selectedPlanResponseBody(store, { plan: ready, order: o as never, matrixStatus: "ready" }));
  // outage on a valid authority: same behaviour
  await harnessReset(h);
  const again = await h.adopt("o-again");
  const readyAgain = await makeReady(h, "o-again");
  store.failWith = new Error("authority store outage");
  try { assertDowngraded(await selectedPlanResponseBody(store, { plan: readyAgain, order: again.o as never, matrixStatus: "ready" })); } finally { store.failWith = undefined; }
  // service-date list: built only from the guarded set, so no notification/menu for a downgraded entry
  store.failWith = new Error("authority store outage");
  try {
    const guarded = await guardReusedPlan(store, readyAgain, again.o as never);
    assert.deepEqual(servicePlansResponseBody([guarded], [again.o as never]).notifications, []);
    assert.deepEqual(servicePlansResponseBody([guarded], [again.o as never]).menus, []);
  } finally { store.failWith = undefined; }
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /selectedPlanResponseBody\(allergenAuthorityStore, \{ plan: selectedPlan/);
  assert.match(route, /servicePlansResponseBody\(visiblePlans, sourceOrders\)/);
  assert.doesNotMatch(route, /plans: selectedPlan \? \[selectedPlan\]/);
  assert.doesNotMatch(route, /notifications: selectedPlan\?\.status/);
});
async function harnessReset(h: H) { await store.mutate(h.compositionId, current => ({ ...current, status: "active" as const, revocation: undefined, cascadePending: false })); }

test("P1-2: a cached projection also requires the CURRENT canonical composition; legacy entries and outages fail closed; readiness is recomputed", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  const other = order("o-plain", ["item:plain"]); other.status = "ready" as never;
  const projection = buildCpuDayProjection("2026-10-20", [o as never, other as never], [ready, planFor(other, {}, { status: "planned" })]);
  const entry = () => projection.orders.find(item => item.id === "o-other")!;
  assert.equal(entry().workflowStatus, "planned"); assert.equal(entry().allergenReadiness, "ready"); assert.equal((projection as { authorityBindingVersion?: number }).authorityBindingVersion, 1);
  const ctx = ctxFor(h);
  assert.equal((await revalidateProjectionAuthority(projection, ctx)).orders.find(item => item.id === "o-other")!.workflowStatus, "planned");
  // (a) bread / instruction change after the projection was cached: the current canonical composition no longer matches
  const changed = order("o-other", ITEMS, {}, { productionInstructions: "Use sourdough" }); h.orders.set("o-other", changed);
  const afterChange = await revalidateProjectionAuthority(projection, ctx);
  const downgradedEntry = afterChange.orders.find(item => item.id === "o-other")!;
  assert.notEqual(downgradedEntry.workflowStatus, "planned"); assert.equal(downgradedEntry.allergenReadiness, "attention"); assert.equal(downgradedEntry.planningReadiness, "attention");
  assert.ok(downgradedEntry.attention.some(text => /allergen review/.test(text)));
  assert.equal(afterChange.summary.planned, 1, "summary recomputed: only the unrelated planned order remains");
  assert.equal(afterChange.summary.attention, 1);
  assert.equal(afterChange.orders.find(item => item.id === "o-plain")!.workflowStatus, "planned", "unrelated entries are untouched");
  // the canonical order cannot be established -> fail closed
  const missing = { store, loadOrder: async (id: string) => (id === "o-other" ? undefined : h.orders.get(id)) as never };
  assert.notEqual((await revalidateProjectionAuthority(projection, missing)).orders.find(item => item.id === "o-other")!.workflowStatus, "planned");
  const throwing = { store, loadOrder: async () => { throw new Error("hub unavailable"); } };
  assert.notEqual((await revalidateProjectionAuthority(projection, throwing)).orders.find(item => item.id === "o-other")!.workflowStatus, "planned");
  h.orders.set("o-other", o);
  // (b) revoked authority
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "corrected");
  assert.notEqual((await revalidateProjectionAuthority(projection, ctx)).orders.find(item => item.id === "o-other")!.workflowStatus, "planned");
  await harnessReset(h);
  // (c) authority-store outage
  store.failWith = new Error("down");
  try { assert.notEqual((await revalidateProjectionAuthority(projection, ctx)).orders.find(item => item.id === "o-other")!.workflowStatus, "planned"); } finally { store.failWith = undefined; }
  // (d) a historical projection without bindings: every Hospitality Planned entry is unverifiable and non-authoritative
  const legacy = JSON.parse(JSON.stringify(projection));
  delete legacy.authorityBindingVersion; for (const item of legacy.orders) delete item.reusedAuthority;
  const legacyChecked = await revalidateProjectionAuthority(legacy, ctx);
  const legacyEntry = legacyChecked.orders.find((item: { id: string }) => item.id === "o-other");
  assert.notEqual(legacyEntry.workflowStatus, "planned"); assert.equal(legacyEntry.allergenReadiness, "attention"); assert.equal(legacyEntry.reusedAuthority, undefined);
  assert.equal(legacyChecked.summary.planned, 0, "both Hospitality entries are unverifiable; no stale planned count survives");
  assert.equal(legacyChecked.orders.every((item: { workflowStatus: string }) => item.workflowStatus !== "planned"), true);
  // (e) the production route serves an unversioned cached package as-is and makes it safe on the RESPONSE (legacy entries downgraded above); it never rebuilds it in place at an unchanged sequence
  const productionRoute = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(productionRoute, /authorityBindingVersion\?: number \}\)\.authorityBindingVersion !== 1/, "no in-place rebuild of a legacy package (CPU_PACKAGE_SEQUENCE_CONFLICT)");
  assert.match(productionRoute, /loadOrder: async \(id: string\) => \(await productionOrderDetail\(request, id\)\)/);
});

test("P1-3: the repository verifies the state being persisted, not just copied provenance (matrix, release matrix, binding, registration)", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const stored = (await h.plans.get("o-other"))!;
  const change = (revision: number) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: stored.id, revision, changeType: "x", actorId: "u", changedAt: AT, idempotencyKey: `p13-${++seq}` }) as never;
  const invalid = (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID";
  // allergen states mutated while the copied provenance is retained
  const mutated = structuredClone(stored); mutated.menuItems[0].subItems[0].allergens.eggs = mutated.menuItems[0].subItems[0].allergens.eggs === "contains" ? "clear" : "contains" as never;
  await assert.rejects(h.plans.save(mutated), invalid);
  await assert.rejects(h.plans.saveAndAppendCpuChange(mutated, undefined, change(50)), invalid);
  // release matrix no longer matches the plan matrix
  const releaseDrift = structuredClone(stored); releaseDrift.currentAllergenRelease!.matrix = releaseDrift.currentAllergenRelease!.matrix.map(row => ({ ...row, allergens: { ...row.allergens, milk: "contains" } }));
  await assert.rejects(h.plans.save(releaseDrift), invalid);
  // release binding differs from the plan's provenance (composition / generation / origin / hash)
  for (const patch of [{ generation: 9 }, { compositionId: "other" }, { matrixSemanticHash: "z" }] as Array<Record<string, unknown>>) {
    const bound = structuredClone(stored); bound.currentAllergenRelease!.reusedAuthority = { ...bound.currentAllergenRelease!.reusedAuthority!, ...patch } as never;
    await assert.rejects(h.plans.save(bound), invalid, JSON.stringify(patch));
  }
  const originDrift = structuredClone(stored); originDrift.currentAllergenRelease!.reusedAuthority!.origin.releaseId = "rel-other";
  await assert.rejects(h.plans.save(originDrift), invalid);
  // provenance copied from the authority but the adopter was never registered
  await store.mutate(h.compositionId, current => ({ ...current, reusedBy: [] }));
  await assert.rejects(h.plans.save(stored), invalid);
  await store.mutate(h.compositionId, current => ({ ...current, reusedBy: [{ orderId: "o-other", generation: 1, at: AT, by: "u" }] }));
  // names and quantities are not allergen statements: the unchanged-meaning write still passes
  const renamed = structuredClone(stored); renamed.menuItems[0].name = "Renamed"; renamed.menuItems[0].subItems[0].quantity = 999; renamed.updatedAt = "2026-10-12T15:00:00.000Z";
  await h.plans.save(renamed);
  assert.equal(o.canonicalId, "o-other");
});

test("P1-4: an authority-backed signed origin cannot disappear or change while its authority stays active (bare save and saveAndAppendCpuChange)", async () => {
  const change = (id: string, revision: number) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: id, revision, changeType: "x", actorId: "u", changedAt: AT, idempotencyKey: `p14-${++seq}` }) as never;
  // (1) the release is removed by a bare save
  let h = await harness();
  const removed = structuredClone(h.originPlan); removed.currentAllergenRelease = undefined; removed.signatures = undefined; removed.signedSignatures = undefined; removed.status = "planning"; removed.updatedAt = "2026-10-12T16:00:00.000Z";
  await h.plans.save(removed);
  assert.equal(authorityOf().status, "revoked", "the repository revoked the authority in the same write");
  assert.equal(authorityOf().cascadePending, true);
  // (2) the release is revoked / reopened through saveAndAppendCpuChange with NO clause
  h = await harness();
  const revokedRelease = structuredClone(h.originPlan); revokedRelease.currentAllergenRelease = { ...revokedRelease.currentAllergenRelease!, status: "revoked" } as never; revokedRelease.updatedAt = "2026-10-12T16:00:00.000Z";
  await h.plans.saveAndAppendCpuChange(revokedRelease, h.originPlan.updatedAt, change(h.originPlan.id, 3));
  assert.equal(authorityOf().status, "revoked");
  // (3) the approved matrix changes while the release stays in place
  h = await harness();
  const edited = structuredClone(h.originPlan); edited.menuItems[0].subItems[0].allergens.eggs = "contains" as never; edited.updatedAt = "2026-10-12T16:00:00.000Z";
  await h.plans.save(edited);
  assert.equal(authorityOf().status, "revoked");
  // (4) quantity / name / date / headcount-only changes (and materialization-style rewrites of the same release) never revoke
  h = await harness();
  const commercial = structuredClone(h.originPlan); commercial.menuItems[0].subItems[0].quantity = 777; commercial.menuItems[0].name = "Renamed"; commercial.planningNotes = "headcount +4"; commercial.updatedAt = "2026-10-12T16:00:00.000Z";
  await h.plans.save(commercial);
  await h.plans.saveAndAppendCpuChange({ ...commercial, currentAllergenRelease: { ...commercial.currentAllergenRelease!, materializationStatus: "ready" } as never, updatedAt: "2026-10-12T16:05:00.000Z" }, commercial.updatedAt, change(h.originPlan.id, 4));
  assert.equal(authorityOf().status, "active");
  // (5) a failed origin write (stale version) rolls the revocation back with it
  h = await harness();
  const stale = structuredClone(h.originPlan); stale.currentAllergenRelease = undefined; stale.status = "planning";
  await assert.rejects(h.plans.save(stale, "not-the-current-version"), /changed elsewhere/);
  assert.equal(authorityOf().status, "active");
  // (6) the unstamped legacy release backs no authority, so nothing is revoked
  h = await harness();
  const legacyOrder = order("o-legacy-signed", ["item:legacy"]); const legacyPlan = signedPlan(legacyOrder, "rel-legacy", {}, false);
  await h.plans.save(legacyPlan);
  const legacyRemoved = structuredClone(legacyPlan); legacyRemoved.currentAllergenRelease = undefined; legacyRemoved.updatedAt = "2026-10-12T16:00:00.000Z";
  await h.plans.save(legacyRemoved);
  assert.equal(authorityOf().status, "active");
});

test("replay semantics: a committed idempotent command is answered from its receipt BEFORE optimistic concurrency (memory repository; the Firestore repository is proven identical in allergen-authority-firestore.test.ts)", async () => {
  const stamp = `replay-${++seq}`;
  const o = order(`o-${stamp}`, ["item:replay"]);
  const repo = createProductionPlanRepository();
  const base = planFor(o);
  await repo.save(base);
  const change = (key: string) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: base.id, revision: 1, changeType: "test", actorId: "u", changedAt: AT, idempotencyKey: key }) as never;
  const first = { ...structuredClone(base), planningNotes: "first", updatedAt: "2026-10-12T11:00:00.000Z" };
  const applied = await repo.saveAndAppendCpuChange(first, base.updatedAt, change(stamp));
  assert.equal(applied.duplicate, undefined);
  const retry = await repo.saveAndAppendCpuChange({ ...first, planningNotes: "retry" }, base.updatedAt, change(stamp));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.sequence, applied.sequence);
  assert.equal((await repo.get(o.canonicalId))!.planningNotes, "first");
  await assert.rejects(repo.saveAndAppendCpuChange({ ...first, planningNotes: "other" }, base.updatedAt, change(`${stamp}-other`)), /changed elsewhere/);
});

let lineCaseCounter = 0;
test("P1-1 (memory repository): line association is preserved for reused plans and for origin invalidation", async () => {
  const env = { label: "memory", plans: createProductionPlanRepository(), store, unique: () => `mem${++lineCaseCounter}${Math.random().toString(36).slice(2, 7)}` };
  await lineCases.reusedPlanLineCases(env);
  await lineCases.originLineCases(env);
});

test("P1-2: every apply-reused-authority response path is guarded and fails closed (new, replay, revoked during delivery, store outage)", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  const ready = await makeReady(h, "o-other");
  // newly applied adoption and idempotent replay while the authority is valid
  const fresh = await applyReuseResponse(store, { plan: ready, order: o as never, materializationDelivery: { status: "delivered" } });
  assert.equal(fresh.status, 200); assert.equal((fresh.body.reuse as { applied: boolean }).applied, true);
  assert.equal((fresh.body.plan as ProductionPlan).status, "planned"); assert.equal(fresh.body.approvedMatrixAvailable, true);
  const replay = await applyReuseResponse(store, { plan: ready, order: o as never, unchanged: true });
  assert.equal(replay.status, 200); assert.equal((replay.body.reuse as { unchanged?: boolean }).unchanged, true);
  const assertFailClosed = (response: Awaited<ReturnType<typeof applyReuseResponse>>) => {
    assert.equal(response.status, 409, "never HTTP 200");
    const plan = response.body.plan as ProductionPlan;
    assert.notEqual(plan.status, "planned");
    assert.equal(plan.currentAllergenRelease, undefined, "the reused release is not exposed as authoritative");
    assert.equal(plan.matrixArtifact, undefined);
    assert.deepEqual(response.body.reuse, { applied: false }, "no success by reuse is reported");
    assert.equal(response.body.approvedMatrixAvailable, false);
    assert.deepEqual(response.body.notifications, []);
  };
  // authority-store outage while the response is being constructed (new adoption AND replay)
  store.failWith = new Error("authority store outage during response construction");
  try {
    assertFailClosed(await applyReuseResponse(store, { plan: ready, order: o as never, materializationDelivery: { status: "delivered" } }));
    assertFailClosed(await applyReuseResponse(store, { plan: ready, order: o as never, unchanged: true }));
  } finally { store.failWith = undefined; }
  // the authority is revoked DURING post-commit delivery: the plan was reloaded after delivery, then the response is built
  const reloadedAfterDelivery = (await h.plans.get("o-other"))!;
  await store.revokeByOrigin(h.compositionId, "rel-origin-1", AT, "head", "revoked while the delivery was in flight");
  assertFailClosed(await applyReuseResponse(store, { plan: reloadedAfterDelivery, order: o as never, materializationDelivery: { status: "delivered" } }));
  assertFailClosed(await applyReuseResponse(store, { plan: reloadedAfterDelivery, order: o as never, unchanged: true }));
  // an adoption that no longer exists (reopened concurrently) is not reported as success either
  const plain = planFor(o, {}, { status: "planning" });
  assertFailClosed(await applyReuseResponse(store, { plan: plain, order: o as never }));
  // the route answers through the builder on every path and never returns the raw reloaded plan
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/finalApplyResponse\(/g) || []).length, 1, "the guarded final-response builder is the only constructor");
  assert.equal((route.match(/finalise\(/g) || []).length, 2, "new adoption and replay both answer through it");
  assert.match(route, /loadOrder: id => loadOrder\(request, id, \{ fresh: true \}\)/, "the LATEST canonical order is reloaded for the final response");
  assert.doesNotMatch(route, /finalPlan/);
  assert.doesNotMatch(route, /reuse: \{ applied: true(, unchanged: true)? \}[^)]*NextResponse|NextResponse\.json\(\{ plan: result\.plan/);
});

test("P1 (stale order): the final apply response validates against the LATEST canonical order, reloaded after the wait", async () => {
  const h = await harness();
  const { o } = await h.adopt("o-other");
  await makeReady(h, "o-other");
  const loads: string[] = [];
  const base = { orderId: "o-other", fallbackPlan: (await h.plans.get("o-other"))!, loadPlan: (id: string) => h.plans.get(id) };
  // order A is still current: success
  const ok = await finalApplyResponse(store, { ...base, loadOrder: async id => { loads.push(id); return o as never; } });
  assert.equal(ok.status, 200); assert.deepEqual(loads, ["o-other"], "the order was reloaded for the response");
  // identity-relevant change (bread instructions) while the command waited: the reloaded order B no longer matches the adopted composition
  const changed = order("o-other", ITEMS, {}, { productionInstructions: "Use sourdough" });
  for (const unchanged of [false, true]) {
    const failed = await finalApplyResponse(store, { ...base, unchanged, loadOrder: async () => changed as never });
    assert.equal(failed.status, 409); assert.equal((failed.body.plan as ProductionPlan).currentAllergenRelease, undefined);
    assert.notEqual((failed.body.plan as ProductionPlan).status, "planned"); assert.deepEqual(failed.body.reuse, { applied: false });
    assert.equal((failed.body.error as { code: string }).code, "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED");
  }
  // the canonical order cannot be loaded (throws or returns nothing): fail closed
  for (const loadOrder of [async () => { throw new Error("hub unavailable"); }, async () => undefined]) {
    const failed = await finalApplyResponse(store, { ...base, loadOrder: loadOrder as never });
    assert.equal(failed.status, 409); assert.deepEqual(failed.body.reuse, { applied: false });
  }
  // the plan is reloaded too: a plan reopened meanwhile is not reported as success
  const failed = await finalApplyResponse(store, { ...base, loadPlan: async () => planFor(o, {}, { status: "planning" }), loadOrder: async () => o as never });
  assert.equal(failed.status, 409);
});

test("identity schemes (memory repository): sourceMenuItemId and sourceOfferingId are distinct fields; records identified through different fields never reuse each other's authority", async () => {
  await schemeCases.identitySchemeCases({ label: "memory", plans: createProductionPlanRepository(), store, unique: () => `mem${++lineCaseCounter}${Math.random().toString(36).slice(2, 7)}` });
});
