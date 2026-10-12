import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorityFromSignedPlan, compositionIdentity, reuseValidity, type CompositionOrder } from "../lib/allergen-composition";
import { applyApproval, applyBeginAdoption, applyFinalizeAdoption, applyOriginRevocation } from "../lib/allergen-authority-store";
import type { ProductionPlan } from "../app/lib/production-plan";
import { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } from "../../shared/allergen-contract";

const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(a => [a, over[a] || "clear"])));
type L = { id: string; item: string; qty?: number; choices?: unknown[]; extra?: Record<string, unknown> };
const order = (id: string, lines: L[], extra: Partial<CompositionOrder> = {}) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`,
  lines: lines.map(l => ({ canonicalId: `${id}:${l.id}`, sourceMenuItemId: l.item, sourceOfferingId: undefined, choices: l.choices || [], workstream: "sandwiches", customerQuantity: l.qty ?? 10, dietaries: { vegan: l.qty ?? 1 }, ...(l.extra || {}) })),
  ...extra,
}) as CompositionOrder & { sourceBookingId: string; sourceQuoteRevisionId: string };
const AT = "2026-10-12T10:00:00.000Z";
const plan = (o: CompositionOrder, over: Record<string, Record<string, string>> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planned", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((l, i) => ({ id: `mi:${i}`, sourceLineId: l.canonicalId, name: `Sandwich ${l.sourceMenuItemId}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${l.sourceMenuItemId}`, name: `Filling ${l.sourceMenuItemId}`, quantity: 10, allergens: states(over[l.sourceMenuItemId!] || {}) as never, note: "", evidenceStatus: "completed" as const }] })),
}) as ProductionPlan;
const signed = (o: CompositionOrder, releaseId: string, over: Record<string, Record<string, string>> = {}, stamp = true) => {
  const p = plan(o, over);
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT }] as never;
  p.signedSignatures = signatures; p.signatures = signatures; p.signedMenuContentHash = "h";
  p.currentAllergenRelease = { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, ...(stamp ? { compositionId: compositionIdentity(o)?.compositionId } : {}) } as never;
  return p;
};
const A = [{ id: "1", item: "item:ham" }, { id: "2", item: "item:veg" }];
const id = (lines: L[]) => compositionIdentity(order("o", lines))?.compositionId;

test("same composition across booking, customer, date, quantities and ordering yields one identity", () => {
  const a = compositionIdentity(order("o-a", [{ id: "1", item: "item:ham", qty: 10 }, { id: "2", item: "item:veg", qty: 5 }]));
  const b = compositionIdentity(order("o-b", [{ id: "9", item: "item:veg", qty: 99 }, { id: "8", item: "item:ham", qty: 1 }], { clientName: "Other", serviceDate: "2027-01-01" } as never));
  assert.ok(a && b); assert.equal(a.compositionId, b.compositionId);
});
test("item added, removed or canonical item ID changed gives a different identity", () => {
  const base = id(A);
  assert.notEqual(base, id([...A, { id: "3", item: "item:egg" }]));
  assert.notEqual(base, id([A[0]]));
  assert.notEqual(base, id([A[0], { id: "2", item: "item:veg2" }]));
  assert.notEqual(base, id([A[0], { id: "2", item: "item:veg", choices: [{ filling: "egg" }] }]));
});
test("choice ordering does not matter; display names never participate", () => {
  const x = id([{ id: "1", item: "i", choices: [{ b: 1, a: 2 }, "z"] }]);
  const o2 = order("o", [{ id: "1", item: "i", choices: ["z", { a: 2, b: 1 }] }]);
  (o2.lines[0] as unknown as { itemName: string }).itemName = "Totally different name";
  assert.equal(x, compositionIdentity(o2)!.compositionId);
});
test("FINDING 7: production-affecting fields participate in identity (bread instructions, substitution, serving, description)", () => {
  const base = id([{ id: "1", item: "i" }]);
  assert.notEqual(base, id([{ id: "1", item: "i", extra: { productionInstructions: "Use sourdough" } }]));
  assert.notEqual(base, id([{ id: "1", item: "i", extra: { substitution: "gluten free bread" } }]));
  assert.notEqual(base, id([{ id: "1", item: "i", extra: { servingGuidance: "Serve on brioche" } }]));
  assert.notEqual(base, id([{ id: "1", item: "i", extra: { description: "Ham and mustard" } }]));
  assert.notEqual(id([{ id: "1", item: "i", extra: { productionInstructions: "Use sourdough" } }]), id([{ id: "1", item: "i", extra: { productionInstructions: "Use rye" } }]));
  // whitespace-only differences are not a difference; commercial fields are not part of identity
  assert.equal(base, id([{ id: "1", item: "i", qty: 500, extra: { productionInstructions: "   ", dietaries: { vegan: 40 } } }]));
});
test("FINDING 7: conflicting line-level evidence and open exceptions make an order ineligible", () => {
  assert.equal(id([{ id: "1", item: "i", extra: { allergenEvidenceStatus: "conflicting" } }]), undefined);
  assert.equal(id([{ id: "1", item: "i", extra: { approvedAllergenSnapshot: { allergens: {}, allergenEvidenceStatus: "conflicting" } } }]), undefined);
  assert.equal(id([{ id: "1", item: "i", extra: { status: "exception" } }]), undefined);
  assert.equal(id([{ id: "1", item: "i", extra: { exceptions: ["bread unavailable"] } }]), undefined);
  assert.notEqual(id([{ id: "1", item: "i", extra: { allergenEvidenceStatus: "confirmed" } }]), id([{ id: "1", item: "i", extra: { allergenEvidenceStatus: "unreviewed" } }]));
});
test("ineligible orders have no identity (fresh review): missing item id, other workstream, other origin, no delivery", () => {
  assert.equal(id([{ id: "1", item: "" }]), undefined);
  const o = order("o", A); o.lines[0].workstream = "hot"; assert.equal(compositionIdentity(o), undefined);
  assert.equal(compositionIdentity(order("o", A, { origin: "menu_planning" } as never)), undefined);
  assert.equal(compositionIdentity(order("o", A, { requiresDelivery: false })), undefined);
});
test("allergen snapshot on the composition: state change or MAY_CONTAIN difference changes identity; unrecorded is not clear", () => {
  const withSnap = (state: string) => { const o = order("o", A); (o.lines[0] as never as { approvedAllergenSnapshot: unknown }).approvedAllergenSnapshot = { allergens: states({ milk: state }), allergenEvidenceStatus: "completed" }; return compositionIdentity(o)!.compositionId; };
  assert.notEqual(withSnap("clear"), withSnap("contains"));
  assert.notEqual(withSnap("contains"), withSnap("may_contain"));
  assert.notEqual(withSnap("clear"), withSnap("unrecorded"));
  assert.notEqual(withSnap("clear"), id(A));
});

test("a signed release must be stamped with the composition it was signed for to establish an authority", () => {
  const o = order("o1", A);
  assert.ok(buildAuthorityFromSignedPlan(signed(o, "r1"), o, AT, "c"));
  assert.equal(buildAuthorityFromSignedPlan(signed(o, "r1", {}, false), o, AT, "c"), undefined, "legacy/unstamped release");
  const changed = order("o1", [...A, { id: "3", item: "item:egg" }]);
  assert.equal(buildAuthorityFromSignedPlan(signed(o, "r1"), changed, AT, "c"), undefined, "composition changed since signing");
});

test("state machine: re-approval after revocation is a NEW generation and archives the old one", () => {
  const o1 = order("o1", A); const g1 = buildAuthorityFromSignedPlan(signed(o1, "r1"), o1, AT, "c")!;
  const revoked = applyOriginRevocation(g1, "r1", AT, "c", "corrected");
  assert.equal(revoked.changed, true); assert.equal(revoked.authority!.status, "revoked"); assert.ok(revoked.authority!.revocation); assert.equal(revoked.authority!.cascadePending, true);
  const o2 = order("o2", A); const cand = buildAuthorityFromSignedPlan(signed(o2, "r2"), o2, AT, "c")!;
  const again = applyApproval(revoked.authority, cand, AT, "c");
  assert.equal(again.change, "reactivated"); assert.equal(again.authority.generation, 2); assert.equal(again.authority.status, "active");
  assert.equal(again.authority.revocation, undefined);
  assert.equal(again.authority.generations[0].generation, 1); assert.equal(again.authority.generations[0].origin.releaseId, "r1");
  assert.equal(again.authority.cascadePending, true, "generation 1 cascade is still outstanding");
  // a revoked release can never silently come back
  assert.equal(applyApproval(again.authority, buildAuthorityFromSignedPlan(signed(o1, "r1"), o1, AT, "c")!, AT, "c").change, "unchanged");
  // revoking again is reported, not ignored, so durable work can be re-ensured
  const retried = applyOriginRevocation(revoked.authority, "r1", AT, "c", "again");
  assert.equal(retried.changed, false); assert.equal(retried.generation, 1); assert.ok(retried.authority);
  assert.equal(applyOriginRevocation(again.authority, "r1", AT, "c", "again").generation, 1, "an archived generation is still addressable by its origin release");
});
test("state machine: conflicting signed approvals revoke the generation (durable revocation intent set atomically)", () => {
  const o1 = order("o1", A); const a = buildAuthorityFromSignedPlan(signed(o1, "r1"), o1, AT, "c")!;
  const o2 = order("o2", A); const b = buildAuthorityFromSignedPlan(signed(o2, "r2", { "item:ham": { milk: "contains" } }), o2, AT, "c")!;
  const out = applyApproval(a, b, AT, "c");
  assert.equal(out.change, "revoked_conflict"); assert.equal(out.authority.status, "revoked"); assert.equal(out.authority.revocation?.releaseId, "r1"); assert.equal(out.authority.cascadePending, true);
});
test("FINDING 3: adoption is a compare-and-set against the exact generation and cannot commit behind a revocation", () => {
  const o1 = order("o1", A); const g1 = buildAuthorityFromSignedPlan(signed(o1, "r1"), o1, AT, "c")!;
  const expect = { generation: 1, releaseId: "r1", matrixSemanticHash: g1.matrixSemanticHash };
  const lease = "2026-10-12T10:05:00.000Z";
  const begun = applyBeginAdoption(g1, expect, "x", AT, "u", lease);
  assert.equal(begun.outcome.ok, true); assert.equal(begun.next!.reusedBy[0].state, "pending");
  assert.equal(applyBeginAdoption(g1, { ...expect, generation: 2 }, "x", AT, "u", lease).outcome.ok, false);
  assert.equal(applyBeginAdoption(g1, { ...expect, matrixSemanticHash: "z" }, "x", AT, "u", lease).outcome.ok, false);
  const revoked = applyOriginRevocation(begun.next, "r1", AT, "c", "r").authority!;
  assert.deepEqual(applyBeginAdoption(revoked, expect, "y", AT, "u", lease).outcome, { ok: false, reason: "authority_revoked" });
  assert.equal(applyFinalizeAdoption(revoked, 1, "x", AT).ok, false, "a pending adoption cannot finalize after revocation");
  assert.equal(applyFinalizeAdoption(begun.next, 1, "x", AT).ok, true);
});
test("reuseValidity binds the adopter to the authority generation, origin release, matrix hash, registration and live matrix", () => {
  const o1 = order("o1", A); const g1 = buildAuthorityFromSignedPlan(signed(o1, "r1"), o1, AT, "c")!;
  g1.reusedBy.push({ orderId: "o-other", generation: 1, state: "committed", at: AT, by: "u" });
  const other = order("o-other", A); const p = plan(other);
  p.reusedAllergenAuthority = { authorityId: `${g1.compositionId}#g1`, compositionId: g1.compositionId, generation: 1, identityVersion: g1.identityVersion, matrixSemanticHash: g1.matrixSemanticHash, adoptedAt: AT, adoptedBy: "u", origin: g1.origin };
  assert.deepEqual(reuseValidity(p, other, g1), { valid: true });
  assert.equal((reuseValidity(p, other, { ...g1, generation: 2 }) as { reason: string }).reason, "generation_mismatch");
  assert.equal((reuseValidity(p, other, { ...g1, origin: { ...g1.origin, releaseId: "r9" } }) as { reason: string }).reason, "origin_release_mismatch");
  assert.equal((reuseValidity(p, other, { ...g1, matrixSemanticHash: "x" }) as { reason: string }).reason, "matrix_hash_mismatch");
  assert.equal((reuseValidity(p, other, { ...g1, reusedBy: [{ orderId: "o-other", generation: 1, state: "pending", at: AT, by: "u" }] }) as { reason: string }).reason, "adoption_not_committed");
  assert.equal((reuseValidity(p, other, undefined) as { reason: string }).reason, "authority_missing");
});
