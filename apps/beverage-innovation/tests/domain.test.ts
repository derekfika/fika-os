import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, transition, addApproval, cloneVersion, updateVersion, type BeverageInnovation } from "../lib/domain";
import { calculateCosting, normaliseIngredientLine, poundsToPence } from "../lib/costing";
import { createMonthlySpecial, transitionMonthlySpecial } from "../lib/specials";
import { beverageRecordSchema, type BeverageRecord } from "../lib/contracts";

const base: BeverageInnovation = { id: "beverage:test", name: "Test", description: "Test", beverageType: "Mocktail", lifecycle: "idea", ownerRole: "Beverage developer", concept: {}, versions: [], prototypes: [], rollouts: [], approvals: [], assets: [], feedback: [] };
const actor = { authmodIdentityId: "fixture:beverage-local-operator", identityKind: "person" as const, displayName: "Fictional Beverage local test actor" as const, action: "Manage" as const, scopeOplocIds: ["fixture-oploc:london"], synthetic: true as const };
const at = "2026-11-07T12:00:00.000Z";
function validRecord(): BeverageRecord {
  const record = { ...base, id: "beverage:test-record", schemaVersion: 2 as const, aggregateVersion: 1, classification: "draft_concept" as const, normalizedName: "test", createdAt: at, updatedAt: at, createdBy: actor.authmodIdentityId, updatedBy: actor.authmodIdentityId };
  return beverageRecordSchema.parse(record);
}

test("lifecycle moves only through governed stages", () => { assert.equal(canTransition("idea", "in_development"), true); assert.equal(canTransition("idea", "live"), false); assert.throws(() => transition(base, "live")); });
test("approval requires operational and brand decisions and freezes the current version", () => {
  const versioned = cloneVersion(base, actor.authmodIdentityId); const ready = { ...versioned, lifecycle: "brand_review" as const };
  assert.throws(() => transition(ready, "approved"));
  const approved = addApproval(addApproval(ready, "operational", "approved", actor.authmodIdentityId), "brand", "approved", actor.authmodIdentityId);
  assert.throws(() => transition(approved, "approved"), /actual drink photograph/i);
  const photoReady = { ...approved, assets: [{ id: "asset:photo", type: "photo" as const, status: "approved" as const, reference: "fixture:reviewed-actual-drink-photo" }] };
  const result = transition(photoReady, "approved"); assert.equal(result.lifecycle, "approved"); assert.equal(result.versions[0].status, "approved");
  assert.throws(() => updateVersion(result, result.currentVersionId!, { recipeNotes: "x", method: "x", equipment: [], ingredients: [] }));
});
test("creating a new version supersedes the prior draft and retains copied recipe lines", () => {
  const first = updateVersion(cloneVersion(base), "beverage:test:version:1", { recipeNotes: "Recipe", method: "Build", equipment: ["Shaker"], ingredients: [{ id: "line:1", name: "Syrup", amount: 20, unit: "ml", costPerUnit: 0.01, sourceStatus: "deferred" }] });
  const second = cloneVersion(first); assert.equal(second.versions[0].status, "superseded"); assert.equal(second.versions[1].ingredients[0].name, "Syrup"); assert.notEqual(second.versions[1].ingredients[0].id, second.versions[0].ingredients[0].id);
});
test("ingredient costs use explicit units and rounded GBP pence with gross profit", () => {
  const line = normaliseIngredientLine({ id: "line:1", name: "Syrup", amount: 20, unit: "ml", costPerUnit: 0.01, sourceStatus: "deferred" });
  const result = calculateCosting([line], poundsToPence("4.50")); assert.equal(result.costPerPortionPence, 20); assert.equal(result.grossProfitPence, 430); assert.equal(result.grossProfitBasisPoints, 9556); assert.equal(result.costStatus, "complete");
  assert.equal(calculateCosting([{ ...line, unit: "g" }], 450).costStatus, "incomplete"); assert.throws(() => normaliseIngredientLine({ ...line, unit: "g" }));
});
test("empty ingredient lists do not claim a complete cost", () => { assert.equal(calculateCosting([], 450).costStatus, "incomplete"); });
test("rollout blockers prevent going live", () => { const blocked = { ...base, lifecycle: "rollout" as const, rollouts: [{ id: "r", oplocId: "fixture-oploc:london", siteLabel: "London", state: "blocked" as const, blockers: ["Equipment"], readiness: { equipment: false, ingredients: "deferred" as const, training: false, assets: false } }] }; assert.throws(() => transition(blocked, "live")); });
test("existing import records remain readable with source evidence that predates candidate fingerprints", () => {
  const sourceEvidence = { fileName: "Pasted fictional text", importedAt: at, sourceKey: "a".repeat(64) };
  assert.deepEqual(beverageRecordSchema.parse({ ...validRecord(), sourceEvidence }).sourceEvidence, sourceEvidence);
});
test("monthly special site assignment is fixture scoped and scheduling requires approved recipe", () => {
  const record = validRecord(); const versioned = cloneVersion(record, actor.authmodIdentityId);
  const beverage = { ...record, ...versioned, versions: versioned.versions.map(version => ({ ...version, status: "approved" as const })) } as BeverageRecord;
  const special = createMonthlySpecial({ title: "November Feature", beverageId: beverage.id, beverageVersionId: beverage.currentVersionId!, month: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30", notes: "Fixture only", targetSites: [{ oplocId: "fixture-oploc:london", siteLabelSnapshot: "Fixture London", assigned: true, blockers: [] }] }, beverage, actor, "special:test", at);
  assert.equal(transitionMonthlySpecial(special, beverage, "scheduled", actor, at).status, "scheduled");
  assert.throws(() => createMonthlySpecial({ title: "Bad scope", beverageId: beverage.id, beverageVersionId: beverage.currentVersionId!, month: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30", notes: "", targetSites: [{ oplocId: "oploc:real", siteLabelSnapshot: "Unknown", assigned: true, blockers: [] }] }, beverage, actor, "special:bad", at));
});
