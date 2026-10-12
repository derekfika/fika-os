import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The real memory plan repository, memory authority store and memory outbox are used (no Firestore, no HTTP).
process.env.FIKA_CPU_PLAN_STORE = "memory";
const { createProductionPlanRepository } = await import("../lib/production-plan-repository");
const { memoryAllergenAuthorityStore } = await import("../lib/allergen-authority-store");
const { applyReuseCommand, cascadeAuthorityRevocation, approvedMatrixChanged, processAuthorityRevocation, AUTHORITY_REVOKED_ROUTE, authorityRevocationEventId } = await import("../lib/allergen-reuse-orchestrator");
const { recordSignedAuthority, reuseViewFor, reuseCandidateFor, failClosedStaleReuse } = await import("../lib/allergen-reuse-service");
const { resetCpuOutboxForTests, listCpuOutboxForTests } = await import("../lib/cpu-durable-outbox");
const { materializeCpuAllergenRelease } = await import("../lib/cpu-allergen-release");
const { currentAllergenReleaseMatchesOrder, reusedAuthorityReleaseMatchesOrder, hasAllergenAuthority } = await import("../app/lib/production-plan");
const { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } = await import("../../shared/allergen-contract");
import type { ProductionPlan } from "../app/lib/production-plan";

const AT = "2026-10-12T10:00:00.000Z";
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));
const order = (id: string, items: string[], extra: Record<string, unknown> = {}) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site",
  lines: items.map((item, index) => ({ canonicalId: `${id}:${index}`, sourceMenuItemId: item, choices: [], workstream: "sandwiches", customerQuantity: 10 + index, itemName: `Display ${index}` })),
  ...extra,
}) as never as import("../lib/production-types").ProductionOrder & { lines: Array<{ canonicalId: string }> };
const planFor = (o: ReturnType<typeof order>, over: Record<string, Record<string, string>> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planning", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((line, i) => ({ id: `mi:${i}`, sourceLineId: line.canonicalId, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${(o.lines[i] as never as { sourceMenuItemId: string }).sourceMenuItemId}`, name: `Filling ${i}`, quantity: 10, allergens: states(over[(o.lines[i] as never as { sourceMenuItemId: string }).sourceMenuItemId] || {}) as never, note: "", evidenceStatus: "completed" as const }] })),
  ...extra,
}) as ProductionPlan;
const signedRelease = (releaseId: string) => {
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
  return { signatures, release: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never };
};

const ITEMS = ["item:ham", "item:veg"];
async function harness() {
  memoryAllergenAuthorityStore.records.clear(); resetCpuOutboxForTests();
  const plans = createProductionPlanRepository();
  const orders = new Map<string, ReturnType<typeof order>>();
  const emitted: Array<{ orderId: string; changeType: string; sequence: number }> = [];
  const deps = { plans, store: memoryAllergenAuthorityStore, loadOrder: async (id: string) => orders.get(id), emit: async (input: { order: { canonicalId: string }; changeType: string; sequence: number }) => { emitted.push({ orderId: input.order.canonicalId, changeType: input.changeType, sequence: input.sequence }); } };
  const originOrder = order("o-origin", ITEMS); orders.set("o-origin", originOrder);
  const { signatures, release } = signedRelease("rel-origin-1");
  const originPlan = planFor(originOrder, { "item:ham": { milk: "contains" } }, { status: "planned", signatures, signedSignatures: signatures, signedMenuContentHash: "h", currentAllergenRelease: release });
  await plans.save(originPlan);
  await recordSignedAuthority(memoryAllergenAuthorityStore, originPlan, originOrder as never, AT, "chef");
  const otherOrder = order("o-other", [...ITEMS].reverse()); orders.set("o-other", otherOrder);
  const otherPlan = planFor(otherOrder, {}, { status: "planning" });
  for (const item of otherPlan.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; }
  await plans.save(otherPlan);
  return { plans, orders, deps, emitted, originOrder, originPlan, otherOrder, otherPlan };
}
const apply = (h: Awaited<ReturnType<typeof harness>>, commandId?: string) => applyReuseCommand(h.deps as never, { plan: structuredClone(h.otherPlan), storedPlan: h.otherPlan, order: h.otherOrder as never, actor: "cpu-chef", actorId: "uid-1", at: "2026-10-12T11:00:00.000Z", ...(commandId ? { commandId } : {}) });

test("end to end: signed origin → authority → reuse release → origin correction → adopter and its release are non-authoritative and invalidated", async () => {
  const h = await harness();
  const originBefore = JSON.stringify(await h.plans.get("o-origin"));
  assert.equal([...memoryAllergenAuthorityStore.records.values()].length, 1);

  const applied = await apply(h, "reuse-command-1");
  assert.equal(applied.changed, true);
  const stored = (await h.plans.get("o-other"))!;
  const release = stored.currentAllergenRelease!;
  assert.equal(release.approvalMode, "reused_authority");
  assert.equal(release.status, "pending");
  assert.deepEqual(release.signatures, []); // never copied or fabricated
  assert.ok(release.releaseId.includes("booking:o-other"));
  assert.equal(release.sourceBookingId, "booking:o-other");
  assert.equal(release.reusedAuthority?.compositionId, stored.reusedAllergenAuthority?.compositionId);
  assert.equal(release.reusedAuthority?.origin.releaseId, "rel-origin-1");
  assert.deepEqual(release.reusedAuthority?.origin.signatures.map(s => s.role).sort(), ["head_chef_site_manager", "production_chef"]);
  assert.equal(stored.status, "planned");
  assert.deepEqual(stored.menuItems.map(i => i.sourceLineId).sort(), ["o-other:0", "o-other:1"]); // keeps its own line identity
  assert.equal(h.emitted.filter(e => e.orderId === "o-other" && e.changeType === "apply-reused-authority").length, 1);
  assert.ok(listCpuOutboxForTests().some(event => event.payload.route === "/api/internal/cpu-release-materialize" && event.payload.body.orderId === "o-other"), "release materialization obligation is committed");

  // Materialization completes (artifacts are produced by the same pipeline; simulated here).
  const artifact = { id: "a", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "c".repeat(64), pdfStatus: "generated", driveStatus: "saved", driveFileId: "f" } as never;
  const ready: ProductionPlan = { ...stored, matrixArtifact: artifact, currentAllergenRelease: materializeCpuAllergenRelease(stored.currentAllergenRelease!, { masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [] }), updatedAt: "2026-10-12T11:05:00.000Z" };
  await h.plans.save(ready);
  assert.equal(reusedAuthorityReleaseMatchesOrder(ready.currentAllergenRelease, h.otherOrder as never, ready.menuItems), true);
  assert.equal(currentAllergenReleaseMatchesOrder(ready.currentAllergenRelease, h.otherOrder as never, ready.menuItems), false, "a reused release must never satisfy the signed-release test");
  assert.equal((await reuseViewFor(memoryAllergenAuthorityStore, ready, h.otherOrder as never))?.applied?.valid, true);

  // Replay is idempotent: no second release, change event, registry entry or authority.
  const replay = await applyReuseCommand(h.deps as never, { plan: structuredClone(ready), storedPlan: ready, order: h.otherOrder as never, actor: "cpu-chef", actorId: "uid-1", at: "2026-10-12T12:00:00.000Z", commandId: "reuse-command-1" });
  assert.equal(replay.changed, false);
  assert.equal(h.emitted.filter(e => e.orderId === "o-other").length, 1);
  assert.equal([...memoryAllergenAuthorityStore.records.values()][0].reusedBy.length, 1);

  // The origin approval is corrected: cascade through the canonical change path.
  h.emitted.length = 0;
  const reopened = await cascadeAuthorityRevocation(h.deps as never, { order: h.originOrder as never, releaseId: "rel-origin-1", actor: "head-chef", actorId: "uid-2", at: "2026-10-12T13:00:00.000Z", reason: "Origin allergen approval corrected" });
  assert.deepEqual(reopened, ["o-other"]);
  const after = (await h.plans.get("o-other"))!;
  assert.equal(after.currentAllergenRelease, undefined);
  assert.equal(after.reusedAllergenAuthority, undefined);
  assert.equal(after.matrixArtifact, undefined);
  assert.notEqual(after.status, "planned");
  assert.equal(after.allergenReleaseHistory?.at(-1)?.status, "revoked");
  assert.equal(after.allergenReleaseHistory?.at(-1)?.approvalMode, "reused_authority");
  assert.equal(hasAllergenAuthority(after), false);
  assert.deepEqual(h.emitted.map(e => [e.orderId, e.changeType]), [["o-other", "allergen-authority-revoked"]]); // projections/consumers are driven from here
  assert.ok(h.emitted[0].sequence > 0, "revocation is a numbered CPU change event");
  assert.equal((await reuseViewFor(memoryAllergenAuthorityStore, after, h.otherOrder as never)), undefined);
  assert.deepEqual(await reuseCandidateFor(memoryAllergenAuthorityStore, after, h.otherOrder as never), { available: false, reason: "authority_revoked" });
  // Cascade replay changes nothing and re-emits nothing.
  h.emitted.length = 0;
  assert.deepEqual(await cascadeAuthorityRevocation(h.deps as never, { order: h.originOrder as never, releaseId: "rel-origin-1", actor: "x", actorId: "u", at: "2026-10-12T14:00:00.000Z", reason: "again" }), []);
  assert.equal(h.emitted.length, 0);
  // The historical signed origin record is untouched by any of this.
  assert.equal(JSON.stringify(await h.plans.get("o-origin")), originBefore);
});

test("a commercial amendment (quantity, date, customer, headcount) keeps the authority; an allergen change or explicit reopen revokes it", async () => {
  const h = await harness();
  const amended = order("o-origin", ITEMS, { serviceDate: "2026-10-27", clientName: "Another customer", version: 2, currentRevision: 2 });
  (amended.lines as never as Array<{ customerQuantity: number }>).forEach(line => { line.customerQuantity = 99; });
  const after = structuredClone(h.originPlan);
  for (const item of after.menuItems) for (const sub of item.subItems) { sub.quantity = 99; sub.name = `${sub.name} (renamed)`; }
  assert.equal(approvedMatrixChanged(h.originPlan, after, amended as never), false);
  const edited = structuredClone(h.originPlan); edited.menuItems[0].subItems[0].allergens.eggs = "contains" as never;
  assert.equal(approvedMatrixChanged(h.originPlan, edited, h.originOrder as never), true);
  // The unchanged authority is still offered to a new booking, including an amended replacement of the origin booking.
  const replacement = order("o-origin-v2", ITEMS);
  const candidate = await reuseCandidateFor(memoryAllergenAuthorityStore, planFor(replacement, {}, { status: "planning" }), replacement as never);
  assert.equal(candidate.available, true);
});

test("historical records without a composition identity fall back to fresh review and cannot adopt", async () => {
  const h = await harness();
  const legacy = order("o-legacy", ITEMS); (legacy.lines as never as Array<{ sourceMenuItemId?: string }>).forEach(line => { delete line.sourceMenuItemId; });
  await h.plans.save(planFor(legacy, {}, { status: "planning" }));
  assert.deepEqual(await reuseCandidateFor(memoryAllergenAuthorityStore, planFor(legacy), legacy as never), { available: false, reason: "composition_unavailable" });
  await assert.rejects(applyReuseCommand(h.deps as never, { plan: planFor(legacy), order: legacy as never, actor: "a", actorId: "u", at: AT }), /no canonical sandwich composition/);
});

test("authority storage is server-only: Admin SDK access, no client SDK, deny-all Firestore rules", async () => {
  const store = await readFile(new URL("../lib/allergen-authority-store.ts", import.meta.url), "utf8");
  assert.match(store, /import\("\.\/firebase-admin"\)/);
  assert.doesNotMatch(store, /firebase\/firestore|firebase\/app|from "firebase"/);
  const rules = await readFile(new URL("../../integration-hub/firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
});

test("the route wires reuse through the canonical change path, not a bare plan write", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /applyReuseCommand\(reuseDeps\(request\)/);
  assert.match(route, /cascadeAuthorityRevocation\(reuseDeps\(request\)/);
  assert.match(route, /emitCpuPlanChange\(request, input\)/);
  assert.match(await readFile(new URL("../app/api/internal/cpu-allergen-authority-revoked/route.ts", import.meta.url), "utf8"), /processAuthorityRevocation/);
  assert.doesNotMatch(route, /reopenAdoptingPlan/);
});

test("durable cascade: a failure part-way through the adopters is retried from the outbox; every adopter ends non-authoritative exactly once", async () => {
  const h = await harness();
  const ids = ["o-a", "o-b", "o-c"];
  for (const id of ids) {
    const o = order(id, ITEMS); h.orders.set(id, o);
    const p = planFor(o, {}, { status: "planning" });
    for (const item of p.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; }
    await h.plans.save(p);
    const r = await applyReuseCommand(h.deps as never, { plan: structuredClone(p), storedPlan: p, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-${id}-command` });
    assert.equal(r.changed, true);
  }
  const commits = new Map<string, number>();
  const emitSuccess = new Map<string, number>();
  const failures = { emitB: 1, commitC: 1 };
  const plans = {
    ...h.plans,
    get: (id: string) => h.plans.get(id),
    getByOrderIds: (x: string[]) => h.plans.getByOrderIds(x),
    save: (p: ProductionPlan, e?: string) => h.plans.save(p, e),
    saveAndAppendCpuChange: async (p: ProductionPlan, e: string | undefined, change: never) => {
      if (p.orderId === "o-c" && failures.commitC-- > 0) throw new Error("injected commit failure for o-c");
      const result = await h.plans.saveAndAppendCpuChange(p, e, change);
      if (!result.duplicate) commits.set(p.orderId, (commits.get(p.orderId) || 0) + 1);
      return result;
    },
  };
  const deps = {
    plans, store: memoryAllergenAuthorityStore, loadOrder: async (id: string) => h.orders.get(id),
    emit: async (input: { order: { canonicalId: string } }) => {
      if (input.order.canonicalId === "o-b" && failures.emitB-- > 0) throw new Error("injected invalidation failure for o-b");
      emitSuccess.set(input.order.canonicalId, (emitSuccess.get(input.order.canonicalId) || 0) + 1);
    },
  };

  // Origin approval corrected: revocation is immediate, adopter work is partly done, and the rest is durable.
  const reopened = await cascadeAuthorityRevocation(deps as never, { order: h.originOrder as never, releaseId: "rel-origin-1", actor: "head", actorId: "u2", at: "2026-10-12T13:00:00.000Z", reason: "corrected" });
  assert.equal(reopened.length, 3);
  const authority = [...memoryAllergenAuthorityStore.records.values()][0];
  assert.equal(authority.status, "revoked", "origin revocation is immediate");
  const compositionId = authority.compositionId;
  const queued = listCpuOutboxForTests().find(event => event.eventId === authorityRevocationEventId(compositionId, "rel-origin-1"));
  assert.ok(queued && queued.payload.route === AUTHORITY_REVOKED_ROUTE, "adopter cascade is durable outbox work");
  const progress = authority.cascades?.["rel-origin-1"];
  assert.equal(progress?.completedAt, undefined, "completion is observable and not yet reached");
  assert.equal(progress?.adopters["o-a"]?.done, true);
  assert.notEqual(progress?.adopters["o-b"]?.done, true);
  assert.notEqual(progress?.adopters["o-c"]?.done, true);

  // Reads fail closed immediately, including for the adopter whose plan has not been rewritten yet (o-c).
  for (const id of ids) {
    const stored = (await h.plans.get(id))!;
    const view = await failClosedStaleReuse(memoryAllergenAuthorityStore, stored, h.orders.get(id) as never);
    assert.equal(view.currentAllergenRelease, undefined, `${id} read exposes no authoritative release`);
    assert.notEqual(view.status, "planned");
  }
  assert.equal((await h.plans.get("o-c"))!.reusedAllergenAuthority !== undefined, true, "o-c is still durably pending");

  // The outbox redelivers the same work item until it succeeds (the failure injections are spent).
  const body = queued!.payload.body as never as Parameters<typeof processAuthorityRevocation>[1];
  const retry = await processAuthorityRevocation(deps as never, body);
  assert.equal(retry.status, "complete");
  assert.equal((await processAuthorityRevocation(deps as never, body)).status, "complete"); // redelivery after success is a no-op

  for (const id of ids) {
    const after = (await h.plans.get(id))!;
    assert.equal(after.currentAllergenRelease, undefined);
    assert.equal(after.reusedAllergenAuthority, undefined);
    assert.notEqual(after.status, "planned");
    assert.equal(after.allergenReleaseHistory?.filter(release => release.status === "revoked").length, 1, `${id} release revoked exactly once`);
    assert.equal(commits.get(id), 1, `${id} CPU revocation change committed exactly once`);
    assert.ok((emitSuccess.get(id) || 0) >= 1, `${id} downstream invalidation delivered`);
  }
  assert.equal(emitSuccess.get("o-a"), 1);
  assert.equal(emitSuccess.get("o-c"), 1);
  const done = [...memoryAllergenAuthorityStore.records.values()][0];
  assert.ok(done.cascades?.["rel-origin-1"]?.completedAt, "completion is recorded");
  assert.equal(done.history.filter(entry => entry.action === "cascade-completed").length, 1);
  assert.equal(JSON.stringify((await h.plans.get("o-origin"))!.currentAllergenRelease?.releaseId), '"rel-origin-1"', "the signed origin record is untouched");
});
