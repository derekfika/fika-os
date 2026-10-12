import assert from "node:assert/strict";
import test from "node:test";
import { compositionIdentity, buildAuthorityFromSignedPlan, type CompositionOrder } from "../lib/allergen-composition";
import { applyApproval, memoryAllergenAuthorityStore } from "../lib/allergen-authority-store";
import { adoptReusableAuthority, reconcileReuse, recordSignedAuthority, reuseCandidateFor, revokeAuthorityForRelease, reopenAdoptingPlan } from "../lib/allergen-reuse-service";
import type { ProductionPlan } from "../app/lib/production-plan";

import { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } from "../../shared/allergen-contract";
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(a => [a, over[a] || "clear"])));
type L = { id: string; item: string; qty?: number; choices?: unknown[] };
const order = (id: string, lines: L[], extra: Partial<CompositionOrder> = {}) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`,
  lines: lines.map(l => ({ canonicalId: `${id}:${l.id}`, sourceMenuItemId: l.item, sourceOfferingId: undefined, choices: l.choices || [], workstream: "sandwiches", customerQuantity: l.qty ?? 10, dietaries: { vegan: l.qty ?? 1 } })),
  ...extra,
}) as CompositionOrder & { sourceBookingId: string; sourceQuoteRevisionId: string };
const AT = "2026-10-12T10:00:00.000Z";
const plan = (o: CompositionOrder, over: Record<string, Record<string, string>> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planned", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((l, i) => ({ id: `mi:${i}`, sourceLineId: l.canonicalId, name: `Sandwich ${l.sourceMenuItemId}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${l.sourceMenuItemId}`, name: `Filling ${l.sourceMenuItemId}`, quantity: 10, allergens: states(over[l.sourceMenuItemId!] || {}) as never, note: "", evidenceStatus: "completed" as const }] })),
  ...extra,
}) as ProductionPlan;
const signed = (o: CompositionOrder, releaseId: string, over: Record<string, Record<string, string>> = {}) => {
  const p = plan(o, over);
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT }] as never;
  p.signedSignatures = signatures; p.signatures = signatures; p.signedMenuContentHash = "h";
  p.currentAllergenRelease = { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures } as never;
  return p;
};
const fresh = () => memoryAllergenAuthorityStore.records.clear();
const A = [{ id: "1", item: "item:ham" }, { id: "2", item: "item:veg" }];

test("same composition across booking, customer, date, quantities and ordering yields one identity", () => {
  const a = compositionIdentity(order("o-a", [{ id: "1", item: "item:ham", qty: 10 }, { id: "2", item: "item:veg", qty: 5 }]));
  const b = compositionIdentity(order("o-b", [{ id: "9", item: "item:veg", qty: 99 }, { id: "8", item: "item:ham", qty: 1 }]));
  assert.ok(a && b); assert.equal(a.compositionId, b.compositionId);
});
test("item added, removed or canonical item ID changed gives a different identity", () => {
  const base = compositionIdentity(order("o", A))!.compositionId;
  assert.notEqual(base, compositionIdentity(order("o", [...A, { id: "3", item: "item:egg" }]))!.compositionId);
  assert.notEqual(base, compositionIdentity(order("o", [A[0]]))!.compositionId);
  assert.notEqual(base, compositionIdentity(order("o", [A[0], { id: "2", item: "item:veg2" }]))!.compositionId);
  assert.notEqual(base, compositionIdentity(order("o", [A[0], { id: "2", item: "item:veg", choices: [{ filling: "egg" }] }]))!.compositionId);
});
test("choice ordering does not matter; display text never participates", () => {
  const x = compositionIdentity(order("o", [{ id: "1", item: "i", choices: [{ b: 1, a: 2 }, "z"] }]))!.compositionId;
  const o2 = order("o", [{ id: "1", item: "i", choices: ["z", { a: 2, b: 1 }] }]);
  (o2.lines[0] as unknown as { itemName: string }).itemName = "Totally different name";
  assert.equal(x, compositionIdentity(o2)!.compositionId);
});
test("ineligible orders have no identity (fresh review): missing item id, other workstream, other origin, no delivery", () => {
  assert.equal(compositionIdentity(order("o", [{ id: "1", item: "" }])), undefined);
  const o = order("o", A); o.lines[0].workstream = "hot"; assert.equal(compositionIdentity(o), undefined);
  assert.equal(compositionIdentity(order("o", A, { origin: "menu_planning" } as never)), undefined);
  assert.equal(compositionIdentity(order("o", A, { requiresDelivery: false })), undefined);
});
test("allergen snapshot on the composition: state change or MAY_CONTAIN difference changes identity; unrecorded is not clear", () => {
  const withSnap = (state: string) => { const o = order("o", A); (o.lines[0] as never as { approvedAllergenSnapshot: unknown }).approvedAllergenSnapshot = { allergens: states({ milk: state }), allergenEvidenceStatus: "completed" }; return compositionIdentity(o)!.compositionId; };
  assert.notEqual(withSnap("clear"), withSnap("contains"));
  assert.notEqual(withSnap("contains"), withSnap("may_contain"));
  assert.notEqual(withSnap("clear"), withSnap("unrecorded"));
  assert.notEqual(withSnap("clear"), compositionIdentity(order("o", A))!.compositionId);
});

test("signed origin creates an authority; another booking reuses it with provenance and no signatures", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); const originPlan = signed(origin, "rel-1", { "item:ham": { milk: "contains" } });
  const outcome = await recordSignedAuthority(store, originPlan, origin, AT, "chef");
  assert.equal(outcome?.change, "created");
  const frozenOrigin = JSON.stringify(originPlan);
  const other = order("o-other", [{ id: "7", item: "item:veg", qty: 3 }, { id: "6", item: "item:ham", qty: 80 }]);
  const otherPlan = plan(other, {}, { status: "planning" });
  for (const item of otherPlan.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; }
  const candidate = await reuseCandidateFor(store, otherPlan, other);
  assert.equal(candidate.available, true);
  const { plan: adopted, changed } = await adoptReusableAuthority(store, otherPlan, other, { by: "cpu", at: AT });
  assert.equal(changed, true);
  assert.equal(adopted.status, "planned");
  assert.equal(adopted.orderId, "o-other"); assert.equal(adopted.id, "production-plan:o-other");
  assert.equal(adopted.currentAllergenRelease, undefined); assert.equal(adopted.signedSignatures, undefined); assert.equal(adopted.signatures, undefined);
  assert.equal(adopted.reusedAllergenAuthority?.origin.orderId, "o-origin");
  assert.equal(adopted.reusedAllergenAuthority?.origin.releaseId, "rel-1");
  assert.equal(adopted.reusedAllergenAuthority?.origin.signatures.length, 2);
  const ham = adopted.menuItems.find(i => i.sourceLineId === "o-other:6")!;
  assert.equal(ham.subItems[0].allergens.milk, "contains");
  assert.equal(ham.subItems[0].quantity, 10);
  assert.equal(JSON.stringify(originPlan), frozenOrigin); // historical signed record untouched
  assert.ok(adopted.audit.some(a => a.action === "allergen-authority-reused"));
});

test("repeated command is idempotent: no duplicate authority, registration or audit", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  const again = await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  assert.equal(again?.change, "unchanged"); assert.equal(store.records.size, 1);
  const other = order("o-other", A); const base = plan(other, {}, { status: "planning" });
  const first = await adoptReusableAuthority(store, base, other, { by: "cpu", at: AT });
  const second = await adoptReusableAuthority(store, first.plan, other, { by: "cpu", at: "2026-10-12T11:00:00.000Z" });
  assert.equal(second.changed, false);
  assert.equal(first.plan.audit.filter(a => a.action === "allergen-authority-reused").length, 1);
  const auth = [...store.records.values()][0];
  assert.equal(auth.reusedBy.filter(r => r.orderId === "o-other").length, 1);
});

test("reuse refused: own authority, signed plan, historical (no identity) record, revoked, different composition", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  await assert.rejects(adoptReusableAuthority(store, plan(origin, {}, { status: "planning" }), origin, { by: "c", at: AT }), /OWN_AUTHORITY|own_authority/i);
  const other = order("o-other", A);
  await assert.rejects(adoptReusableAuthority(store, signed(other, "rel-x"), other, { by: "c", at: AT }), /PLAN_ALREADY_SIGNED|plan_already_signed/i);
  const historical = order("o-old", [{ id: "1", item: "" }]);
  assert.deepEqual(await reuseCandidateFor(store, plan(historical), historical), { available: false, reason: "composition_unavailable" });
  const diff = order("o-diff", [...A, { id: "3", item: "item:egg" }]);
  assert.deepEqual(await reuseCandidateFor(store, plan(diff, {}, { status: "planning" }), diff), { available: false, reason: "authority_missing" });
  await revokeAuthorityForRelease(store, origin, "rel-1", { by: "c", at: AT, reason: "x" });
  assert.deepEqual(await reuseCandidateFor(store, plan(other, {}, { status: "planning" }), other), { available: false, reason: "authority_revoked" });
});

test("a tampered authority fails closed", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  const auth = [...store.records.values()][0]; auth.approvedMatrix[0].subItems[0].allergens.milk = "contains";
  const other = order("o-other", A);
  await assert.rejects(adoptReusableAuthority(store, plan(other, {}, { status: "planning" }), other, { by: "c", at: AT }), /INTEGRITY_FAILED|integrity_failed/i);
});

test("incomplete or unrecorded matrices never establish an authority", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); const p = signed(origin, "rel-1"); p.menuItems[0].subItems[0].allergens = { ...states(), milk: "unrecorded" } as never;
  assert.equal(await recordSignedAuthority(store, p, origin, AT, "chef"), undefined);
  assert.equal(store.records.size, 0);
});

test("amendment after reuse: composition change, manual edit, own signature and revocation each invalidate", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  const other = order("o-other", A);
  const { plan: adopted } = await adoptReusableAuthority(store, plan(other, {}, { status: "planning" }), other, { by: "cpu", at: AT });
  const ctx = { by: "cpu", at: AT };
  assert.equal(await reconcileReuse(store, structuredClone(adopted), other, ctx), false);
  const amended = order("o-other", [...A, { id: "3", item: "item:egg" }]);
  const p1 = structuredClone(adopted); assert.equal(await reconcileReuse(store, p1, amended, ctx), true); assert.equal(p1.reusedAllergenAuthority, undefined); assert.equal(p1.status, "planning");
  const p2 = structuredClone(adopted); p2.menuItems[0].subItems[0].allergens.milk = "contains" as never;
  assert.equal(await reconcileReuse(store, p2, other, ctx), true); assert.equal(p2.status, "planning");
  const p3 = signed(other, "rel-own"); p3.reusedAllergenAuthority = adopted.reusedAllergenAuthority;
  assert.equal(await reconcileReuse(store, p3, other, ctx), true); assert.ok(p3.currentAllergenRelease);
  const reopened = await revokeAuthorityForRelease(store, origin, "rel-1", { ...ctx, reason: "origin changed" });
  assert.deepEqual(reopened, ["o-other"]);
  const p4 = structuredClone(adopted); assert.equal(reopenAdoptingPlan(p4, ctx), true); assert.equal(p4.status, "planning");
  const p5 = structuredClone(adopted); assert.equal(await reconcileReuse(store, p5, other, ctx), true);
});

test("revoking an unrelated release does not revoke the authority; re-approval after revoke keeps history", async () => {
  fresh(); const store = memoryAllergenAuthorityStore;
  const origin = order("o-origin", A); await recordSignedAuthority(store, signed(origin, "rel-1"), origin, AT, "chef");
  assert.deepEqual(await revokeAuthorityForRelease(store, origin, "rel-other", { by: "c", at: AT, reason: "x" }), []);
  assert.equal([...store.records.values()][0].status, "active");
  await revokeAuthorityForRelease(store, origin, "rel-1", { by: "c", at: AT, reason: "x" });
  const again = order("o-again", A); await recordSignedAuthority(store, signed(again, "rel-2"), again, AT, "chef");
  const auth = [...store.records.values()][0];
  assert.equal(auth.status, "active"); assert.equal(auth.origin.releaseId, "rel-2"); assert.equal(auth.supersededOrigins[0].releaseId, "rel-1");
  assert.deepEqual(auth.history.map(h => h.action), ["approved", "revoked", "re-approved"]);
});

test("conflicting signed approval for the same composition revokes rather than choosing", () => {
  const origin = order("o1", A); const a = buildAuthorityFromSignedPlan(signed(origin, "r1"), origin, AT, "c")!;
  const o2 = order("o2", A);
  const b = buildAuthorityFromSignedPlan(signed(o2, "r2", { "item:ham": { milk: "contains" } }), o2, AT, "c")!;
  assert.equal(applyApproval(a, b, AT, "c").authority.status, "revoked");
});
