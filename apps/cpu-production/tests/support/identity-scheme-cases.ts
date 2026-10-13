import assert from "node:assert/strict";
import { applyReuseCommand, recordSignedApproval } from "../../lib/allergen-reuse-orchestrator";
import { reuseCandidateFor } from "../../lib/allergen-reuse-service";
import { compositionIdentity } from "../../lib/allergen-composition";
import type { AllergenAuthorityStore } from "../../lib/allergen-authority-store";
import type { ProductionPlanRepository } from "../../lib/production-plan-repository";
import { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } from "../../../shared/allergen-contract";
import type { ProductionPlan } from "../../app/lib/production-plan";

/**
 * Identity-scheme cases, run against BOTH the memory and the Firestore repository/store. `sourceMenuItemId` (legacy shape) and
 * `sourceOfferingId` (current Hospitality shape) are distinct identity fields: records identified through different fields must
 * never reuse each other's authority, even when the raw strings are equal.
 */
const AT = "2026-10-12T10:00:00.000Z";
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));
type Ids = { item?: string; offering?: string };
const order = (id: string, specs: Ids[]) => ({
  canonicalId: id, origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate: "2026-10-20", requiredBy: "2026-10-20T11:00:00.000Z", clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal",
  lines: specs.map((spec, index) => ({ canonicalId: `${id}:${index}`, ...(spec.item ? { sourceMenuItemId: spec.item } : {}), ...(spec.offering ? { sourceOfferingId: spec.offering } : {}), choices: [], workstream: "sandwiches", customerQuantity: 10 + index, itemName: `Display ${index}` })),
}) as never as import("../../lib/production-types").ProductionOrder & { lines: Array<{ canonicalId: string }> };
type O = ReturnType<typeof order>;
const planFor = (o: O, over: Record<string, string> = {}, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: `production-plan:${o.canonicalId}`, orderId: o.canonicalId, status: "planning", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [],
  menuItems: o.lines.map((line, i) => ({ id: `mi:${i}`, sourceLineId: line.canonicalId, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${i}`, name: `Filling ${i}`, quantity: 10, allergens: states(over) as never, note: "", evidenceStatus: "completed" as const }] })),
  ...extra,
}) as ProductionPlan;
const blank = (p: ProductionPlan) => { for (const item of p.menuItems) for (const sub of item.subItems) { sub.allergens = {} as never; sub.evidenceStatus = "not_completed"; } return p; };

export type SchemeEnv = { label: string; plans: ProductionPlanRepository; store: AllergenAuthorityStore; unique: () => string };

export async function identitySchemeCases(env: SchemeEnv) {
  const raw = `hospitality-menu-item:${env.unique()}:deli_sandwich_lunch`; // the SAME raw string is used through different fields
  const signedOrigin = async (specs: Ids[]) => {
    const o = order(`o-origin-${env.unique()}`, specs);
    const compositionId = compositionIdentity(o as never)!.compositionId;
    const releaseId = `rel-${env.unique()}`;
    const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
    const p = planFor(o, { milk: "contains" }, { status: "planned", signatures, signedSignatures: signatures, signedMenuContentHash: "h", currentAllergenRelease: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, compositionId, masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never });
    await env.plans.save(p);
    await recordSignedApproval({ store: env.store }, p, o as never, AT, "chef");
    assert.ok(await env.store.get(compositionId), `${env.label}: authority recorded for ${JSON.stringify(specs)}`);
    return { o, compositionId };
  };
  const orders = new Map<string, O>();
  const candidate = async (specs: Ids[]) => { const o = order(`o-adopter-${env.unique()}`, specs); orders.set(o.canonicalId, o); const p = blank(planFor(o)); await env.plans.save(p); return { o, p, availability: await reuseCandidateFor(env.store, p, o as never) }; };
  const deps = { plans: env.plans, store: env.store, loadOrder: async (id: string) => orders.get(id), emit: async () => undefined };
  const adopt = (c: { o: O; p: ProductionPlan }) => applyReuseCommand(deps as never, { plan: structuredClone(c.p), storedPlan: c.p, order: c.o as never, actor: "cpu", actorId: "u", at: "2026-10-12T11:00:00.000Z", commandId: `reuse-${env.unique()}-command` });

  // legacy shape (sourceMenuItemId only): reuses only legacy-shaped records
  await signedOrigin([{ item: raw }]);
  const legacy = await candidate([{ item: raw }]);
  assert.equal(legacy.availability.available, true, `${env.label}: legacy shape reuses legacy shape`);
  assert.equal((await adopt(legacy)).changed, true);
  const newer = await candidate([{ offering: raw }]);
  assert.deepEqual(newer.availability, { available: false, reason: "authority_missing" }, `${env.label}: same raw string via sourceOfferingId must NOT match`);
  await assert.rejects(adopt(newer), /authority_missing/i);
  const both = await candidate([{ item: raw, offering: raw }]);
  assert.deepEqual(both.availability, { available: false, reason: "authority_missing" }, `${env.label}: both fields present is a different identity`);

  // current Hospitality shape (sourceOfferingId only): reuses only offering-shaped records
  const offeringRaw = `${raw}:offering`;
  await signedOrigin([{ offering: offeringRaw }]);
  const current = await candidate([{ offering: offeringRaw }]);
  assert.equal(current.availability.available, true, `${env.label}: current shape reuses current shape`);
  assert.equal((await adopt(current)).changed, true);
  const crossed = await candidate([{ item: offeringRaw }]);
  assert.deepEqual(crossed.availability, { available: false, reason: "authority_missing" }, `${env.label}: the legacy field with the same raw string must NOT reuse an offering-identified authority`);
  await assert.rejects(adopt(crossed), /authority_missing/i);

  // both present: reuses only records with both fields equal
  const pairItem = `${raw}:pair-item`, pairOffering = `${raw}:pair-offering`;
  await signedOrigin([{ item: pairItem, offering: pairOffering }]);
  assert.equal((await candidate([{ item: pairItem, offering: pairOffering }])).availability.available, true, `${env.label}: both fields equal reuses`);
  assert.equal((await candidate([{ item: pairItem }])).availability.available, false, `${env.label}: only one of the two fields does not`);
  assert.equal((await candidate([{ offering: pairOffering }])).availability.available, false);
  assert.equal((await candidate([{ item: pairItem, offering: `${pairOffering}-other` }])).availability.available, false, `${env.label}: either field differing breaks reuse`);
  // neither field: ineligible
  assert.deepEqual((await candidate([{}])).availability, { available: false, reason: "composition_unavailable" }, `${env.label}: neither field is ineligible`);
}
