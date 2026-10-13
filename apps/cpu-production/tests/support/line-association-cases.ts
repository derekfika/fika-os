import assert from "node:assert/strict";
import { applyReuseCommand, recordSignedApproval } from "../../lib/allergen-reuse-orchestrator";
import { compositionIdentity } from "../../lib/allergen-composition";
import type { AllergenAuthorityStore } from "../../lib/allergen-authority-store";
import type { ProductionPlanRepository } from "../../lib/production-plan-repository";
import { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } from "../../../shared/allergen-contract";
import type { ProductionPlan } from "../../app/lib/production-plan";

/**
 * One set of line-association cases run against BOTH the memory and the Firestore repository (and their authority stores), so the
 * two implementations are proven to pass and fail identically.
 */
const AT = "2026-10-12T10:00:00.000Z";
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));
const order = (id: string, items: string[]) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal",
  lines: items.map((item, index) => ({ canonicalId: `${id}:${index}`, sourceMenuItemId: item, choices: [], workstream: "sandwiches", customerQuantity: 10 + index, itemName: `Display ${index}` })),
}) as never as import("../../lib/production-types").ProductionOrder & { lines: Array<{ canonicalId: string }> };
type O = ReturnType<typeof order>;
const planFor = (o: O, over: Record<string, Record<string, string>> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planning", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((line, i) => { const item = (line as never as { sourceMenuItemId: string }).sourceMenuItemId; return { id: `mi:${i}`, sourceLineId: line.canonicalId, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${item}`, name: `Filling ${i}`, quantity: 10, allergens: states(over[item] || {}) as never, note: "", evidenceStatus: "completed" as const }] }; }),
  ...extra,
}) as ProductionPlan;
const blank = (p: ProductionPlan) => { for (const item of p.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; } return p; };
const invalid = (error: { code?: string }) => error.code === "CPU_REUSED_AUTHORITY_INVALID";

export type CaseEnv = { label: string; plans: ProductionPlanRepository; store: AllergenAuthorityStore; unique: () => string };

async function scenario(env: CaseEnv) {
  const items = [`item:${env.unique()}:ham`, `item:${env.unique()}:veg`];
  const originOrder = order(`o-origin-${env.unique()}`, items);
  const compositionId = compositionIdentity(originOrder as never)!.compositionId;
  const releaseId = `rel-${env.unique()}`;
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
  // two lines with DIFFERENT allergen statements, so a cross-line swap keeps the flattened set but changes who owns what
  const originPlan = planFor(originOrder, { [items[0]]: { milk: "contains" }, [items[1]]: { eggs: "contains" } }, { status: "planned", signatures, signedSignatures: signatures, signedMenuContentHash: "h", currentAllergenRelease: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, compositionId, masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never });
  await env.plans.save(originPlan);
  await recordSignedApproval({ store: env.store }, originPlan, originOrder as never, AT, "chef");
  const orders = new Map<string, O>([[originOrder.canonicalId, originOrder]]);
  const deps = { plans: env.plans, store: env.store, loadOrder: async (id: string) => orders.get(id), emit: async () => undefined };
  const adopter = async () => {
    const o = order(`o-adopter-${env.unique()}`, items); orders.set(o.canonicalId, o);
    const p = blank(planFor(o)); await env.plans.save(p);
    const result = await applyReuseCommand(deps as never, { plan: structuredClone(p), storedPlan: p, order: o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-${env.unique()}-command` });
    assert.equal(result.changed, true, `${env.label}: adoption`);
    return { o, stored: (await env.plans.get(o.canonicalId))! };
  };
  const change = (plan: ProductionPlan) => ({ serviceDate: "2026-10-20", entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length + 1, changeType: "test", actorId: "u", changedAt: AT, idempotencyKey: `case-${env.unique()}` }) as never;
  return { items, originOrder, originPlan, compositionId, releaseId, adopter, change };
}
const swapSubItems = (plan: ProductionPlan) => { const next = structuredClone(plan); const [a, b] = next.menuItems; [a.subItems, b.subItems] = [b.subItems, a.subItems]; next.updatedAt = "2026-10-12T16:00:00.000Z"; return next; };
const flattened = (plan: ProductionPlan) => JSON.stringify([...new Set(plan.menuItems.flatMap(item => item.subItems.map(sub => JSON.stringify([sub.productionItemId, sub.allergens]))))].sort());

/** Reused plan versus authority. */
export async function reusedPlanLineCases(env: CaseEnv) {
  const s = await scenario(env);
  const { stored } = await s.adopter();
  assert.deepEqual(Object.keys(stored.reusedAllergenAuthority!.lineBindings).sort(), stored.menuItems.map(item => item.sourceLineId!).sort(), `${env.label}: every canonical line is bound at adoption`);
  // exact same matrix, different ordering: passes
  const reordered = structuredClone(stored); reordered.menuItems.reverse(); for (const item of reordered.menuItems) item.subItems.reverse(); reordered.updatedAt = "2026-10-12T14:00:00.000Z";
  await env.plans.save(reordered);
  // quantity / name only: intentionally excluded, passes (through save-and-append too)
  const quantities = structuredClone(reordered); quantities.menuItems[0].subItems[0].quantity = 999; quantities.menuItems[0].name = "Renamed"; quantities.menuItems[1].subItems[0].name = "Other name"; quantities.updatedAt = "2026-10-12T15:00:00.000Z";
  await env.plans.saveAndAppendCpuChange(quantities, reordered.updatedAt, s.change(quantities));
  // cross-line reassignment: the flattened set of statements is unchanged, the association is not -> rejected, nothing written
  const current = (await env.plans.get(stored.orderId))!;
  const swapped = swapSubItems(current);
  assert.equal(flattened(swapped), flattened(current), "precondition: the global flattened statement set is identical");
  await assert.rejects(env.plans.save(swapped), invalid, `${env.label}: bare save`);
  await assert.rejects(env.plans.saveAndAppendCpuChange(swapped, current.updatedAt, s.change(swapped)), invalid, `${env.label}: save-and-append`);
  assert.equal(JSON.stringify((await env.plans.get(stored.orderId))!.menuItems), JSON.stringify(current.menuItems), `${env.label}: persisted plan unchanged`);
  // a consistent forgery (swap the sub-items AND the line bindings) is stopped by binding immutability
  const forged = swapSubItems(current); const [lineA, lineB] = Object.keys(forged.reusedAllergenAuthority!.lineBindings);
  const bindings = forged.reusedAllergenAuthority!.lineBindings; [bindings[lineA], bindings[lineB]] = [bindings[lineB], bindings[lineA]];
  await assert.rejects(env.plans.save(forged), invalid, `${env.label}: re-associated line bindings`);
  // moving statements between lines by editing one sub-item's allergens is rejected as well
  const edited = structuredClone(current); edited.menuItems[0].subItems[0].allergens = { ...edited.menuItems[1].subItems[0].allergens } as never; edited.updatedAt = "2026-10-12T17:00:00.000Z";
  await assert.rejects(env.plans.save(edited), invalid, `${env.label}: copied statements`);
}

/** Origin plan: automatic invalidation of the authority. */
export async function originLineCases(env: CaseEnv) {
  // cross-line reassignment of the signed origin's sub-items (flattened set unchanged) revokes the authority
  let s = await scenario(env);
  assert.equal(flattened(swapSubItems(s.originPlan)), flattened(s.originPlan), "precondition: the global flattened statement set is identical");
  await env.plans.save(swapSubItems(s.originPlan));
  const revoked = (await env.store.get(s.compositionId))!;
  assert.equal(revoked.status, "revoked", `${env.label}: cross-line reassignment revokes the authority`);
  assert.equal(revoked.cascadePending, true);
  // through save-and-append as well
  s = await scenario(env);
  await env.plans.saveAndAppendCpuChange(swapSubItems(s.originPlan), s.originPlan.updatedAt, s.change(s.originPlan));
  assert.equal((await env.store.get(s.compositionId))!.status, "revoked", `${env.label}: via saveAndAppendCpuChange`);
  // ordering and quantity/name-only edits of the origin do not revoke
  s = await scenario(env);
  const reordered = structuredClone(s.originPlan); reordered.menuItems.reverse(); for (const item of reordered.menuItems) item.subItems.reverse();
  reordered.menuItems[0].subItems[0].quantity = 777; reordered.menuItems[1].name = "Renamed"; reordered.updatedAt = "2026-10-12T16:00:00.000Z";
  await env.plans.save(reordered);
  assert.equal((await env.store.get(s.compositionId))!.status, "active", `${env.label}: ordering / quantity / name only does not revoke`);
}
