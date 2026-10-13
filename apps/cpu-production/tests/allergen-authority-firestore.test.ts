import assert from "node:assert/strict";
import test from "node:test";

/**
 * Firestore-backed proof of the shared-authority persistence invariant. These tests run against the REAL Firestore emulator:
 *
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/cpu-production && npx tsx --test tests/allergen-authority-firestore.test.ts"
 *
 * They never set FIKA_CPU_PLAN_STORE=memory and construct the Firestore repository/store explicitly. Without an emulator the
 * suite skips (the memory-repository equivalents live in allergen-reuse-orchestration.test.ts).
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const { createFirestoreProductionPlanRepository } = await import("../lib/production-plan-repository");
const { createFirestoreAllergenAuthorityStore, ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION } = await import("../lib/allergen-authority-store");
const { applyReuseCommand, processAuthorityRevocation, recordSignedApproval, originRevocationClause } = await import("../lib/allergen-reuse-orchestrator");
const { guardReusedPlan } = await import("../lib/allergen-reuse-service");
const { compositionIdentity } = await import("../lib/allergen-composition");
const { cpuChangeReceipts } = await import("../lib/cpu-projection-repository");
const { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } = await import("../../shared/allergen-contract");
const lineCases = await import("./support/line-association-cases");
const schemeCases = await import("./support/identity-scheme-cases");
const { applyReuseResponse } = await import("../lib/cpu-plan-response");
import type { ProductionPlan } from "../app/lib/production-plan";

const plans = createFirestoreProductionPlanRepository();
const store = createFirestoreAllergenAuthorityStore();
const run = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const AT = "2026-10-12T10:00:00.000Z";
let counter = 0;
const unique = () => `${run}-${++counter}`;
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));
const order = (id: string, items: string[]) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal",
  lines: items.map((item, index) => ({ canonicalId: `${id}:${index}`, sourceMenuItemId: item, choices: [], workstream: "sandwiches", customerQuantity: 10 + index, itemName: `Display ${index}` })),
}) as never as import("../lib/production-types").ProductionOrder & { lines: Array<{ canonicalId: string }> };
type O = ReturnType<typeof order>;
const planFor = (o: O, over: Record<string, Record<string, string>> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planning", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((line, i) => ({ id: `mi:${i}`, sourceLineId: line.canonicalId, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${(line as never as { sourceMenuItemId: string }).sourceMenuItemId}`, name: `Filling ${i}`, quantity: 10, allergens: states(over[(line as never as { sourceMenuItemId: string }).sourceMenuItemId] || {}) as never, note: "", evidenceStatus: "completed" as const }] })),
  ...extra,
}) as ProductionPlan;
const blank = (p: ProductionPlan) => { for (const item of p.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; } return p; };
const change = (plan: ProductionPlan, key = unique()) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length + 1, changeType: "test", actorId: "u", changedAt: AT, idempotencyKey: key }) as never;
const invalid = (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID";

async function scenario() {
  const items = [`item:${unique()}:ham`, `item:${unique()}:veg`];
  const originOrder = order(`o-origin-${unique()}`, items);
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
  const releaseId = `rel-${unique()}`;
  const compositionId = compositionIdentity(originOrder as never)!.compositionId;
  const originPlan = planFor(originOrder, { [items[0]]: { milk: "contains" } }, { status: "planned", signatures, signedSignatures: signatures, signedMenuContentHash: "h", currentAllergenRelease: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, compositionId, masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never });
  await plans.save(originPlan);
  await recordSignedApproval({ store }, originPlan, originOrder as never, AT, "chef");
  const orders = new Map<string, O>([[originOrder.canonicalId, originOrder]]);
  const emitted: string[] = [];
  const deps = { plans, store, loadOrder: async (id: string) => orders.get(id), emit: async (input: { order: { canonicalId: string } }) => { emitted.push(input.order.canonicalId); } };
  const add = async (suffix = "") => { const o = order(`o-adopter-${unique()}${suffix}`, items); orders.set(o.canonicalId, o); const p = blank(planFor(o)); await plans.save(p); return { o, p }; };
  const adopt = async (a: { o: O; p: ProductionPlan }, commandId = `reuse-${unique()}-command`) => applyReuseCommand(deps as never, { plan: structuredClone(a.p), storedPlan: a.p, order: a.o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId });
  return { items, originOrder, originPlan, releaseId, compositionId, orders, emitted, deps, add, adopt };
}
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

test("Firestore: adoption is one transaction (plan, release, change event and committed registry entry together)", opts, async () => {
  const s = await scenario();
  const a = await s.add();
  const result = await s.adopt(a, `reuse-${unique()}-fs-command`);
  assert.equal(result.changed, true);
  const stored = (await plans.get(a.o.canonicalId))!;
  assert.equal(stored.currentAllergenRelease?.approvalMode, "reused_authority");
  assert.equal(stored.reusedAllergenAuthority?.generation, 1);
  const authority = (await store.get(s.compositionId))!;
  assert.equal(authority.reusedBy.filter(item => item.orderId === a.o.canonicalId).length, 1);
  assert.equal(authority.generation, 1);
  assert.equal((await guardReusedPlan(store, stored, a.o as never)).currentAllergenRelease?.approvalMode, "reused_authority");
  // replay of the same command is a duplicate, never a second registration
  const replay = await s.adopt({ o: a.o, p: stored }, (result as { plan: ProductionPlan }).plan.audit.length ? `reuse-${unique()}-other` : "x");
  assert.equal(replay.changed, false);
  assert.equal((await store.get(s.compositionId))!.reusedBy.filter(item => item.orderId === a.o.canonicalId).length, 1);
});

test("Firestore: the repository rejects a reused plan whose persisted states differ from the authority matrix, even with copied provenance", opts, async () => {
  const s = await scenario();
  const a = await s.add();
  await s.adopt(a);
  const stored = (await plans.get(a.o.canonicalId))!;
  const mutated = structuredClone(stored); mutated.menuItems[0].subItems[0].allergens.eggs = mutated.menuItems[0].subItems[0].allergens.eggs === "contains" ? "clear" : "contains" as never;
  const key = unique();
  await assert.rejects(plans.save(mutated), invalid);
  await assert.rejects(plans.saveAndAppendCpuChange(mutated, undefined, change(mutated, key)), invalid);
  assert.equal((await cpuChangeReceipts().doc(key).get()).exists, false, "no change event or receipt was written");
  assert.equal(JSON.stringify((await plans.get(a.o.canonicalId))!.menuItems), JSON.stringify(stored.menuItems), "the persisted plan is unchanged");
  const drift = structuredClone(stored); drift.currentAllergenRelease!.matrix = drift.currentAllergenRelease!.matrix.map(row => ({ ...row, allergens: { ...row.allergens, milk: "contains" } }));
  await assert.rejects(plans.save(drift), invalid);
  for (const patch of [{ generation: 9 }, { compositionId: "other" }, { matrixSemanticHash: "z" }] as Array<Record<string, unknown>>) {
    const bound = structuredClone(stored); bound.currentAllergenRelease!.reusedAuthority = { ...bound.currentAllergenRelease!.reusedAuthority!, ...patch } as never;
    await assert.rejects(plans.save(bound), invalid, JSON.stringify(patch));
  }
  const unregistered = structuredClone(stored);
  await store.mutate(s.compositionId, current => ({ ...current, reusedBy: [] }));
  await assert.rejects(plans.save(unregistered), invalid);
});

test("Firestore: rollback when the authority effect fails (revoked authority): no plan, no change receipt, no registration", opts, async () => {
  const s = await scenario();
  const a = await s.add();
  const before = JSON.stringify(await plans.get(a.o.canonicalId));
  await store.revokeByOrigin(s.compositionId, s.releaseId, AT, "head", "corrected");
  const key = `reuse-${unique()}-rollback`;
  await assert.rejects(s.adopt(a, key), (error: { code?: string }) => error.code === "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED" || /cannot be reused|no longer available/.test(String(error)));
  assert.equal(JSON.stringify(await plans.get(a.o.canonicalId)), before);
  assert.equal((await cpuChangeReceipts().doc(key).get()).exists, false);
  assert.equal((await store.get(s.compositionId))!.reusedBy.length, 0);
  // an origin write that fails optimistic concurrency rolls its revocation back with it
  const s2 = await scenario();
  const reopened = structuredClone(s2.originPlan); reopened.currentAllergenRelease = undefined; reopened.status = "planning";
  const clause = originRevocationClause({ before: s2.originPlan.currentAllergenRelease, beforePlan: s2.originPlan, plan: reopened, order: s2.originOrder as never, actor: "head", at: AT, explicitReopen: true });
  await assert.rejects(plans.saveAndAppendCpuChange(reopened, "not-the-current-version", change(reopened), clause), /changed elsewhere/);
  assert.equal((await store.get(s2.compositionId))!.status, "active");
});

test("Firestore: concurrent adoption and revocation never leave an adopter behind a revoked authority", opts, async () => {
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const s = await scenario();
    const adopters = await Promise.all([s.add(), s.add(), s.add()]);
    const settled = await Promise.allSettled([
      ...adopters.map(a => s.adopt(a)),
      store.revokeByOrigin(s.compositionId, s.releaseId, AT, "head", "corrected"),
    ]);
    const authority = (await store.get(s.compositionId))!;
    assert.equal(authority.status, "revoked");
    for (const a of adopters) {
      const stored = (await plans.get(a.o.canonicalId))!;
      if (stored.reusedAllergenAuthority) assert.ok(authority.reusedBy.some(item => item.orderId === a.o.canonicalId), `iteration ${iteration}: a committed adopter must be registered so the cascade covers it`);
      else assert.ok(!authority.reusedBy.some(item => item.orderId === a.o.canonicalId), `iteration ${iteration}: a rejected adoption must leave no registration`);
    }
    // whatever committed is covered by the durable cascade, and nothing adopts afterwards
    const work = { compositionId: s.compositionId, generation: 1, releaseId: s.releaseId, actor: "head", actorId: "u", at: AT, reason: "corrected" };
    assert.equal((await processAuthorityRevocation(s.deps as never, work)).status, "complete");
    for (const a of adopters) { const stored = (await plans.get(a.o.canonicalId))!; assert.equal(stored.reusedAllergenAuthority, undefined); assert.equal(stored.currentAllergenRelease, undefined); }
    const late = await s.add();
    await assert.rejects(s.adopt(late), /cannot be reused|no longer available/);
    assert.ok(settled.some(result => result.status === "fulfilled"), "the revocation itself succeeded");
  }
});

test("Firestore: an authority-backed signed origin cannot disappear or change while its authority stays active; commercial edits are allowed", opts, async () => {
  const mutate = async (edit: (p: ProductionPlan) => void, expectRevoked: boolean, appendChange: boolean) => {
    const s = await scenario();
    const next = structuredClone(s.originPlan); edit(next); next.updatedAt = "2026-10-12T16:00:00.000Z";
    if (appendChange) await plans.saveAndAppendCpuChange(next, s.originPlan.updatedAt, change(next)); else await plans.save(next);
    const authority = (await store.get(s.compositionId))!;
    assert.equal(authority.status, expectRevoked ? "revoked" : "active");
    if (expectRevoked) assert.equal(authority.cascadePending, true);
  };
  await mutate(p => { p.currentAllergenRelease = undefined; p.signatures = undefined; p.signedSignatures = undefined; p.status = "planning"; }, true, false);
  await mutate(p => { p.currentAllergenRelease = { ...p.currentAllergenRelease!, status: "revoked" } as never; }, true, true);
  await mutate(p => { p.menuItems[0].subItems[0].allergens.eggs = "contains" as never; }, true, false);
  await mutate(p => { p.menuItems[0].subItems[0].quantity = 777; p.menuItems[0].name = "Renamed"; p.planningNotes = "headcount +4"; }, false, false);
  await mutate(p => { p.currentAllergenRelease = { ...p.currentAllergenRelease!, materializationStatus: "ready" } as never; p.menuItems[0].subItems[0].quantity = 1; }, false, true);
});

test("Firestore replay semantics equal the memory repository: a committed idempotent command is answered from its receipt BEFORE optimistic concurrency", opts, async () => {
  const stamp = unique();
  for (const [label, repo] of [["firestore", plans]] as const) {
    const o = order(`o-replay-${stamp}-${label}`, [`item:${stamp}:replay`]);
    const base = planFor(o);
    await repo.save(base);
    const first = { ...structuredClone(base), planningNotes: "first", updatedAt: "2026-10-12T11:00:00.000Z" };
    const key = `replay-${stamp}-${label}`;
    const applied = await repo.saveAndAppendCpuChange(first, base.updatedAt, change(first, key));
    assert.equal(applied.duplicate, undefined);
    // the retry still carries the OLD version; the command already committed, so it is a duplicate, not a conflict
    const retry = await repo.saveAndAppendCpuChange({ ...first, planningNotes: "retry" }, base.updatedAt, change(first, key));
    assert.equal(retry.duplicate, true);
    assert.equal(retry.sequence, applied.sequence);
    assert.equal((await repo.get(o.canonicalId))!.planningNotes, "first", "the duplicate did not re-apply");
    // a DIFFERENT command with a stale version is still a conflict
    await assert.rejects(repo.saveAndAppendCpuChange({ ...first, planningNotes: "other" }, base.updatedAt, change(first, `${key}-other`)), /changed elsewhere/);
  }
  // the in-memory repository implements the same ordering; the identical assertions run against it in allergen-reuse-orchestration.test.ts
});

test("Firestore: two simultaneous identical commands commit exactly once", opts, async () => {
  const stamp = unique();
  const o = order(`o-concurrent-${stamp}`, [`item:${stamp}:c`]);
  const base = planFor(o);
  await plans.save(base);
  const key = `concurrent-${stamp}`;
  const attempt = (note: string) => plans.saveAndAppendCpuChange({ ...structuredClone(base), planningNotes: note, updatedAt: "2026-10-12T11:00:00.000Z" }, base.updatedAt, change(base, key));
  const results = await Promise.allSettled([attempt("a"), attempt("b")]);
  const fulfilled = results.filter(result => result.status === "fulfilled") as Array<PromiseFulfilledResult<{ sequence: number; duplicate?: boolean }>>;
  assert.ok(fulfilled.length >= 1);
  assert.equal(new Set(fulfilled.map(result => result.value.sequence)).size, 1, "both callers observe the same single change sequence");
  assert.equal(fulfilled.filter(result => !result.value.duplicate).length, 1, "exactly one caller applied the command");
});

test("Firestore authority documents live in the server-only collection", opts, async () => {
  assert.equal(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION, "fikaCpuAllergenCompositionAuthoritiesV1");
});

test("Firestore: cross-line reassignment of a reused plan's approved sub-items is rejected (flattened set unchanged); ordering and quantity-only changes pass", opts, async () => {
  await lineCases.reusedPlanLineCases({ label: "firestore", plans, store, unique });
});

test("Firestore: cross-line reassignment of a signed origin's matrix revokes its authority in the same transaction", opts, async () => {
  await lineCases.originLineCases({ label: "firestore", plans, store, unique });
});

test("Firestore: the apply response is guarded; an authority revoked after commit never yields a successful reuse response", opts, async () => {
  const s = await scenario();
  const a = await s.add();
  await s.adopt(a);
  const stored = (await plans.get(a.o.canonicalId))!;
  const ok = await applyReuseResponse(store, { plan: stored, order: a.o as never });
  assert.equal(ok.status, 200);
  await store.revokeByOrigin(s.compositionId, s.releaseId, AT, "head", "revoked during delivery");
  const reloaded = (await plans.get(a.o.canonicalId))!;
  const revoked = await applyReuseResponse(store, { plan: reloaded, order: a.o as never });
  assert.equal(revoked.status, 409);
  assert.equal((revoked.body.plan as ProductionPlan).currentAllergenRelease, undefined);
  assert.deepEqual(revoked.body.reuse, { applied: false });
});

test("Firestore: sourceMenuItemId and sourceOfferingId are distinct identity fields; records identified through different fields never reuse each other's authority", opts, async () => {
  await schemeCases.identitySchemeCases({ label: "firestore", plans, store, unique });
});
