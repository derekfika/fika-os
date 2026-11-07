import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BeverageActor } from "../../lib/runtime";

process.env.FIREBASE_PROJECT_ID = "demo-fika-os";
process.env.FIKA_RUNTIME_MODE = "local";
process.env.FIKA_BEVERAGE_LOCAL_AUTH = "fixture";

const { createBeverage, createImportedBeverage, createSpecial, listBeverageAudit, recordApproval, setLifecycle, setSpecialStatus, createVersion, updateVersion } = await import("../../lib/store");
const { commitBeverageCommand, getBeverage: fetchBeverage, listMonthlySpecials, beverageCollections } = await import("../../lib/repository");
const { beverageRecordSchema } = await import("../../lib/contracts");
const { previewPastedRecipe } = await import("../../lib/import-preview");
const actor: BeverageActor = { authmodIdentityId: "fixture:beverage-test-operator", identityKind: "person", displayName: "Fictional Beverage local test actor", action: "Contribute", scopeOplocIds: ["fixture-oploc:london"], synthetic: true };

test("Firestore emulator persists versioned records and append-only idempotency audit", async () => {
  const key = `emulator-test:${randomUUID()}`;
  const created = await createBeverage({ name: `Persistence Fixture ${randomUUID()}`, description: "Fictional emulator-only beverage.", beverageType: "Mocktail" }, actor, 0, key);
  assert.equal(created.aggregateVersion, 1);
  const repeated = await createBeverage({ name: created.name, description: created.description, beverageType: created.beverageType }, actor, 0, key);
  assert.equal(repeated.id, created.id);
  const fetched = await fetchBeverage(created.id);
  assert.equal(fetched?.name, created.name);
  const moved = await setLifecycle(created.id, "in_development", actor, created.aggregateVersion!, `emulator-test:${randomUUID()}`);
  assert.equal(moved.aggregateVersion, 2);
  await assert.rejects(() => setLifecycle(created.id, "in_development", actor, created.aggregateVersion!, `emulator-test:${randomUUID()}`), /changed since it was loaded/);
  const history = await listBeverageAudit(created.id);
  assert.deepEqual(history.map(event => event.versionAfter).sort(), [1, 2]);
  assert.ok(history.every(event => event.actorId === actor.authmodIdentityId));
});

test("imported local recipes, approved versions and monthly site assignments persist in the emulator", async () => {
  const importKey = `emulator-import:${randomUUID()}`;
  const parsed = previewPastedRecipe({ text: "Name: Emulator Citrus Recipe\nType: Mocktail\nIngredient: 20 ml orange juice\nMethod: Shake with ice", classification: "draft_concept" });
  const imported = await createImportedBeverage(parsed.candidate, parsed.sourceHash, actor, importKey);
  assert.equal(imported.sourceEvidence?.sourceKey, parsed.sourceHash);
  assert.equal(imported.versions[0].allergenStatus, "awaiting_canonical_source");
  const second = await createVersion(imported.id, actor, imported.aggregateVersion!, `emulator-version:${randomUUID()}`);
  let versioned = await updateVersion(second.id, second.currentVersionId!, { recipeNotes: "Citrus recipe", method: "Shake", ingredients: [{ id: "line:emulator", name: "Orange juice", amount: 20, unit: "ml", costPerUnit: 0.01, sourceStatus: "deferred" }], equipment: ["Shaker"], sellingPriceExVat: "4.50" }, actor, second.aggregateVersion!, `emulator-recipe:${randomUUID()}`);
  versioned = await setLifecycle(versioned.id, "ready_for_approval", actor, versioned.aggregateVersion!, `emulator-ready:${randomUUID()}`);
  versioned = await recordApproval(versioned.id, "operational", "approved", actor, versioned.aggregateVersion!, `emulator-ops:${randomUUID()}`);
  versioned = await recordApproval(versioned.id, "brand", "approved", actor, versioned.aggregateVersion!, `emulator-brand:${randomUUID()}`);
  versioned = await setLifecycle(versioned.id, "brand_review", actor, versioned.aggregateVersion!, `emulator-review:${randomUUID()}`);
  await assert.rejects(() => setLifecycle(versioned.id, "approved", actor, versioned.aggregateVersion!, `emulator-blocked-photo:${randomUUID()}`), /actual drink photograph/i);
  versioned = await commitBeverageCommand({ entityType: "beverage", collection: beverageCollections.beverages, entityId: versioned.id, action: "beverage.photo.fixture-approved", expectedVersion: versioned.aggregateVersion!, idempotencyKey: `emulator-photo:${randomUUID()}`, actor, summary: { fixturePhoto: true }, schema: beverageRecordSchema, mutate: current => ({ ...current!, assets: [{ id: "asset:fixture-photo", type: "photo", status: "approved", reference: "fixture:reviewed-actual-drink-photo" } as const] }) });
  versioned = await setLifecycle(versioned.id, "approved", actor, versioned.aggregateVersion!, `emulator-approve:${randomUUID()}`);
  assert.equal(versioned.versions.find(version => version.id === versioned.currentVersionId)?.status, "approved");
  const special = await createSpecial({ title: "Emulator Citrus Special", beverageId: versioned.id, beverageVersionId: versioned.currentVersionId!, month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", notes: "Fictional emulator test.", targetSites: [{ oplocId: "fixture-oploc:london", siteLabelSnapshot: "Fixture London", assigned: true, blockers: [] }] }, actor, 0, `emulator-special:${randomUUID()}`);
  const scheduled = await setSpecialStatus(special.id, "scheduled", { ...actor, action: "Manage" }, special.aggregateVersion, `emulator-schedule:${randomUUID()}`);
  assert.equal(scheduled.status, "scheduled");
  assert.equal((await listMonthlySpecials()).some(item => item.id === special.id), true);
  assert.equal((await fetchBeverage(imported.id))?.sourceEvidence?.sourceKey, parsed.sourceHash);
});
