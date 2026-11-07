import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BeverageActor } from "../../lib/runtime";
import type { LocalImportPreview, BeverageRecord } from "../../lib/contracts";

process.env.FIREBASE_PROJECT_ID = "demo-fika-os";
process.env.FIKA_RUNTIME_MODE = "local";
process.env.FIKA_BEVERAGE_LOCAL_AUTH = "fixture";
process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "Contribute";

const { createBeverage, createImportedBeverage, createSpecial, listBeverageAudit, recordApproval, setLifecycle, setSpecialStatus, createVersion, updateVersion } = await import("../../lib/store");
const { commitBeverageCommand, getBeverage: fetchBeverage, listMonthlySpecials, beverageCollections } = await import("../../lib/repository");
const { beverageRecordSchema } = await import("../../lib/contracts");
const { previewPastedRecipes, requirePastedRecipeCandidate } = await import("../../lib/import-preview");
const { beverageDb } = await import("../../lib/firestore-admin");
const { POST: previewImport } = await import("../../app/api/imports/preview/route");
const { POST: commitImport } = await import("../../app/api/imports/commit/route");
const { GET: readBeverages, POST: postBeverage, PATCH: patchBeverage } = await import("../../app/api/beverages/route");
const { GET: readSpecials, POST: postSpecial } = await import("../../app/api/specials/route");
const { PATCH: patchSpecial } = await import("../../app/api/specials/[id]/route");
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
  const text = "Name: Emulator Citrus Recipe\nType: Mocktail\nIngredient: 20 ml orange juice\nMethod: Shake with ice";
  const parsed = previewPastedRecipes(text);
  const candidate = parsed.candidates[0];
  const source = requirePastedRecipeCandidate({ text, sourceHash: parsed.sourceHash, candidateIndex: candidate.index, candidateHash: candidate.candidateHash });
  const imported = await createImportedBeverage(candidate.recipe, "draft_concept", source, actor, importKey);
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
  assert.equal((await listMonthlySpecials(actor)).some(item => item.id === special.id), true);
  assert.equal((await fetchBeverage(imported.id))?.sourceEvidence?.sourceKey, parsed.sourceHash);
});

test("actual import routes preview without writes and atomically commit the edited selected candidate once", async () => {
  const duplicateName = `Existing fixture ${randomUUID()}`;
  await createBeverage({ name: duplicateName, description: "A fictional local duplicate.", beverageType: "Mocktail" }, actor, 0, `emulator-duplicate:${randomUUID()}`);
  const text = [
    `Name: ${duplicateName}`,
    "Type: Mocktail",
    "Ingredient: 20 ml lime juice",
    "Method: Stir.",
    "Name: Fictional Reviewed Cooler",
    "Type: Mocktail",
    "Ingredient: mint leaves",
    "Method: Serve.",
    "Glassware: Highball",
    "Equipment: Spoon",
  ].join("\n");
  const count = async (name: string) => (await beverageDb().collection(name).count().get()).data().count;
  const before = [await count(beverageCollections.beverages), await count(beverageCollections.audit)];
  const request = (action: string, body: unknown, key?: string) => new Request(`http://localhost:13617/api/imports/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
  const previewResponse = await previewImport(request("preview", { text }));
  assert.equal(previewResponse.status, 200);
  const result: LocalImportPreview = await previewResponse.json();
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates[0].warnings.some(warning => warning.includes("local Beverage records")));
  assert.ok(result.candidates[1].warnings.some(warning => warning.includes("Quantity and unit")));
  assert.deepEqual([await count(beverageCollections.beverages), await count(beverageCollections.audit)], before);

  const candidate = result.candidates[1];
  const reviewedCandidate = {
    ...candidate.recipe, name: "Reviewed and corrected fixture cooler",
    ingredients: [{ name: "Mint sprig", amount: 1, unit: "each" }, { name: "Soda water" }],
    method: "Stir gently and serve chilled.", garnish: "Mint leaf",
  };
  const body = {
    text, sourceHash: result.sourceHash, candidateIndex: candidate.index, candidateHash: candidate.candidateHash,
    classification: "draft_concept", reviewed: true, reviewedCandidate,
  };
  const key = `emulator-reviewed-import:${randomUUID()}`;
  const [firstResponse, replayResponse] = await Promise.all([
    commitImport(request("commit", body, key)),
    commitImport(request("commit", body, key)),
  ]);
  assert.equal(firstResponse.status, 201);
  assert.equal(replayResponse.status, 201);
  const { record, sourceHash }: { record: BeverageRecord; sourceHash: string } = await firstResponse.json();
  assert.equal((await replayResponse.json()).record.id, record.id);
  assert.equal(record.name, reviewedCandidate.name);
  assert.equal(record.lifecycle, "in_development");
  assert.equal(record.classification, "draft_concept");
  assert.equal(sourceHash, result.sourceHash);
  assert.deepEqual(record.sourceEvidence, {
    fileName: result.sourceLabel, importedAt: record.createdAt, sourceKey: result.sourceHash,
    candidate: { index: 1, hash: candidate.candidateHash },
  });
  assert.equal(record.concept.notes, "Garnish: Mint leaf");
  const version = record.versions[0];
  assert.equal(version.method, reviewedCandidate.method);
  assert.deepEqual(version.equipment, ["Highball", "Spoon"]);
  assert.equal(version.ingredients[0].quantityMilli, 1000);
  assert.equal(version.ingredients[0].unitCostMicropounds, undefined);
  assert.equal(version.ingredients[1].quantityMilli, undefined);
  assert.ok(version.ingredients.every(line => line.sourceStatus === "deferred"));
  assert.equal(version.costing?.costStatus, "incomplete");
  assert.equal(version.allergenStatus, "awaiting_canonical_source");
  assert.deepEqual(version.allergens, []);

  const changedReview = await commitImport(request("commit", { ...body, reviewedCandidate: { ...reviewedCandidate, name: "Different review" } }, key));
  assert.equal(changedReview.status, 409);
  assert.equal((await changedReview.json()).error.code, "BEVERAGE_IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual([await count(beverageCollections.beverages), await count(beverageCollections.audit)], before.map(value => value + 1));
  const audit = await listBeverageAudit(record.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].summary.candidateIndex, 1);
  assert.equal(audit[0].summary.candidateHash, candidate.candidateHash);
  assert.equal(audit[0].summary.sourceHash, result.sourceHash);
  assert.match(String(audit[0].summary.commandFingerprint), /^[a-f0-9]{64}$/);
});

function fixturePermissions(t: TestContext, id: string) {
  const keys = ["FIKA_BEVERAGE_LOCAL_ACTOR_ID", "FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS", "FIKA_BEVERAGE_LOCAL_OPLOC_IDS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.FIKA_BEVERAGE_LOCAL_ACTOR_ID = id;
  return (actions: string, oplocIds = "") => {
    process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = actions;
    process.env.FIKA_BEVERAGE_LOCAL_OPLOC_IDS = oplocIds;
  };
}

function localRequest(path: string, method: string, body?: unknown, key = `emulator-scope:${randomUUID()}`) {
  return new Request(`http://localhost:13617/api/${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  });
}

test("Beverage routes separate View, Contribute, Manage and Approve and protect governed record fields", async t => {
  const permissions = fixturePermissions(t, "fixture:beverage-permission-test");
  permissions("Contribute");
  const created = await postBeverage(localRequest("beverages", "POST", {
    name: "Fictional permissions drink", description: "Fixture only.", beverageType: "Mocktail", expectedVersion: 0,
  }));
  assert.equal(created.status, 201);
  const { record }: { record: BeverageRecord } = await created.json();
  const command = (extra: Record<string, unknown>, expectedVersion = 1) =>
    patchBeverage(localRequest("beverages", "PATCH", { id: record.id, expectedVersion, ...extra }));
  assert.equal((await readBeverages(localRequest("beverages", "GET"))).status, 403);
  assert.equal((await command({ lifecycle: "in_development" })).status, 403);
  assert.equal((await command({ action: "approval", kind: "operational", decision: "approved" })).status, 403);
  const injected = await command({ action: "update", patch: {
    lifecycle: "approved", approvals: [], assets: [], versions: [], createdBy: "fixture:forged-actor",
  } });
  assert.equal(injected.status, 400);
  assert.equal((await fetchBeverage(record.id))?.lifecycle, "idea");
  assert.equal((await listBeverageAudit(record.id)).length, 1);
  assert.equal((await command({ action: "update", patch: { name: "Reviewed fixture name" } })).status, 200);
  const version = await command({ action: "version" }, 2);
  assert.equal(version.status, 200);
  assert.equal((await version.json()).record.versions.length, 1);

  permissions("Manage");
  assert.equal((await command({ action: "approval", kind: "operational", decision: "approved" }, 3)).status, 403);
  assert.equal((await command({ action: "unknown", lifecycle: "ready_for_approval" }, 3)).status, 400);
  assert.equal((await command({ lifecycle: "ready_for_approval" }, 3)).status, 200);
  permissions("Approve");
  assert.equal((await command({ action: "version" }, 4)).status, 403);
  const approved = await command({ action: "approval", kind: "operational", decision: "approved" }, 4);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).record.approvals[0].actorId, "fixture:beverage-permission-test");
  permissions("View");
  assert.equal((await readBeverages(localRequest("beverages", "GET"))).status, 200);
  assert.equal((await command({ action: "update", patch: { name: "Blocked edit" } }, 5)).status, 403);
});

test("monthly special routes check current and proposed site scopes, including exact retries", async t => {
  const permissions = fixturePermissions(t, "fixture:beverage-special-permission-test");
  const london = "fixture-oploc:london";
  const munich = "fixture-oploc:munich";
  const fullScope = [london, munich].join(",");
  const createdBeverage = await createBeverage({ name: "Fixture scoped launch", description: "Fixture only.", beverageType: "Mocktail" }, actor, 0, `fixture-scoped-launch:${randomUUID()}`);
  const versioned = await createVersion(createdBeverage.id, actor, 1, `fixture-scoped-version:${randomUUID()}`);
  const targets = (...ids: string[]) => ids.map(oplocId => ({ oplocId, siteLabelSnapshot: oplocId, assigned: true, blockers: [] }));
  const post = (title: string, ...ids: string[]) => postSpecial(localRequest("specials", "POST", {
    expectedVersion: 0, title, beverageId: versioned.id, beverageVersionId: versioned.currentVersionId,
    month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", targetSites: targets(...ids), notes: "",
  }));
  const edit = (id: string, body: unknown, key?: string) => patchSpecial(localRequest(`specials/${id}`, "PATCH", body, key), { params: Promise.resolve({ id }) });
  const visibleIds = async () => {
    const result = await readSpecials(localRequest("specials", "GET"));
    assert.equal(result.status, 200);
    return (await result.json()).specials.map((item: { id: string }) => item.id);
  };
  permissions("Manage", fullScope);
  const londonResponse = await post("Fixture London only", london);
  const mixedResponse = await post("Fixture London and Munich", london, munich);
  const unassignedResponse = await post("Fixture unassigned draft");
  assert.equal(londonResponse.status, 201);
  assert.equal(mixedResponse.status, 201);
  assert.equal(unassignedResponse.status, 201);
  const londonId = (await londonResponse.json()).special.id;
  const mixedId = (await mixedResponse.json()).special.id;
  const unassignedId = (await unassignedResponse.json()).special.id;
  const notesCommand = { expectedVersion: 1, patch: { notes: "Reviewed with access to both sites." } };
  const replayKey = `fixture-special-replay:${randomUUID()}`;
  const initialEdit = await edit(mixedId, notesCommand, replayKey);
  assert.equal(initialEdit.status, 200);
  assert.equal((await edit(mixedId, notesCommand, replayKey)).status, 200);
  const beforeDenied = await listBeverageAudit(mixedId);
  assert.equal(beforeDenied.length, 2);
  permissions("View", london);
  const narrowed = await visibleIds();
  assert.ok(narrowed.includes(londonId));
  assert.ok(narrowed.includes(unassignedId));
  assert.ok(!narrowed.includes(mixedId));
  assert.equal((await post("View cannot create", london)).status, 403);
  permissions("Manage", london);
  for (const response of [
    await post("Outside fixture scope", munich),
    await edit(londonId, { expectedVersion: 1, patch: { targetSites: targets(munich) } }),
    await edit(mixedId, { expectedVersion: 2, patch: { targetSites: targets(london) } }),
    await edit(mixedId, { expectedVersion: 2, status: "cancelled" }),
    await edit(mixedId, notesCommand, replayKey),
  ]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "AUTHMOD_OPLOC_DENIED");
  }
  assert.deepEqual(await listBeverageAudit(mixedId), beforeDenied);
  assert.equal((await edit(londonId, { expectedVersion: 1, status: "cancelled" })).status, 200);
  process.env.FIKA_BEVERAGE_LOCAL_ACTOR_ID = "fixture:different-beverage-test";
  permissions("View", fullScope);
  const differentActor = await visibleIds();
  assert.ok(differentActor.includes(mixedId));
  assert.ok(!differentActor.includes(unassignedId));
  permissions("Manage", fullScope);
  assert.equal((await edit(unassignedId, { expectedVersion: 1, patch: { targetSites: targets(london) } })).status, 403);
});
