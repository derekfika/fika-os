import test from "node:test";
import assert from "node:assert/strict";
import { applyPlan, assertApproval, buildPlan, firestoreValue, sha256, validateResumableDestination } from "./engine.mjs";

const sv = stringValue => ({ stringValue });
const record = (path, fields, updateTime = "2026-10-17T00:00:00Z") => ({ path, fields, updateTime });
const source = records => ({ project: "fika-os-dev", records });
const destination = records => ({ project: "fika-os", records });

test("builds deterministic exact-path plan, explicit exclusions and identity transform", () => {
  const input = source([
    record("authmodIdentities/authid:person", { id: sv("authid:person"), externalProvider: sv("firebase"), externalUid: sv("staging-uid"), normalizedEmail: sv("person@example.com"), fullAccess: { booleanValue: true } }),
    record("integrationHubCanonical/item:1", { entityType: sv("Hospitality Menu Item") }),
    record("fikaBookings/booking:1", { status: sv("confirmed") }),
  ]);
  const one = buildPlan(input, destination([]));
  const two = buildPlan(input, destination([]));
  assert.equal(one.planHash, two.planHash);
  assert.equal(one.sourceDocumentCount, 3);
  assert.equal(one.retainedCount, 2);
  assert.equal(one.excludedCount, 1);
  assert.deepEqual(one.transformedByRule, { "authmod-identities-clear-staging-firebase-binding": 1, "authmod-identities-reset-staging-full-access": 1 });
  assert.deepEqual(one.actions[0].transforms, ["authmod-identities-clear-staging-firebase-binding", "authmod-identities-reset-staging-full-access"]);
  assert.equal(one.actions.find(x => x.path.startsWith("fikaBookings/")).reason, "hospitality-booking-history");
  assert.equal(one.invariantProblems.length, 0);
  assert.equal(firestoreValue(sv("firebase")), "firebase");
});

test("requires both explicit hash approvals and zero invariant problems", () => {
  const plan = buildPlan(source([record("authmodApplications/hub", { id: sv("hub") })]), destination([]));
  assert.throws(() => assertApproval(plan, { apply: false, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }), /--apply/);
  assert.throws(() => assertApproval(plan, { apply: true, planHash: plan.planHash }, {}), /APPROVED_PLAN_HASH/);
  assert.doesNotThrow(() => assertApproval(plan, { apply: true, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }));
  const broken = { ...plan, invariantProblems: ["problem"] };
  assert.throws(() => assertApproval(broken, { apply: true, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }), /invariantProblems/);
});

test("create-only apply verifies each write and resumes identical partial writes", async () => {
  const plan = buildPlan(source([
    record("integrationHubCanonical/item:1", { entityType: sv("Hospitality Menu Item") }),
    record("integrationHubCanonical/item:2", { entityType: sv("Hospitality Menu Offering") }),
  ]), destination([]));
  const sourceDocs = new Map(plan.actions.filter(x => x.action.startsWith("create")).map(x => [x.path, record(x.path, { entityType: sv(x.path.endsWith("1") ? "Hospitality Menu Item" : "Hospitality Menu Offering") })]));
  const targetDocs = new Map();
  const journalWrites = [];
  const adapters = {
    async readSource(path) { return sourceDocs.get(path); },
    async readDestination(path) { return targetDocs.get(path); },
    async createDestination(path, fields) { assert.equal(targetDocs.has(path), false, "create-only adapter must not overwrite"); targetDocs.set(path, { path, fields }); },
    async saveJournal(value) { journalWrites.push(Object.keys(value).length); },
  };
  const journal = {};
  await applyPlan(plan, adapters, journal);
  assert.equal(targetDocs.size, 2);
  assert.equal(Object.keys(journal).length, 2);
  assert.deepEqual(journalWrites, [1, 2]);
  const retry = await applyPlan(plan, adapters, {});
  assert.equal(Object.keys(retry).length, 2);
});

test("fails closed on source drift and differing destination conflicts", async () => {
  const original = record("integrationHubCanonical/item:1", { entityType: sv("Hospitality Menu Item") });
  const plan = buildPlan(source([original]), destination([]));
  const driftAdapters = { async readSource() { return record(original.path, { entityType: sv("changed") }); }, async readDestination() { return undefined; }, async createDestination() { assert.fail("must not write after drift"); } };
  await assert.rejects(applyPlan(plan, driftAdapters), /Source drift/);

  const conflict = record(original.path, { entityType: sv("different") });
  assert.throws(() => validateResumableDestination(plan, destination([conflict])), /Unexpected or differing/);
  const differentAdapters = { async readSource() { return original; }, async readDestination() { return conflict; }, async createDestination() { assert.fail("must not overwrite conflict"); } };
  await assert.rejects(applyPlan(plan, differentAdapters), /Create-only conflict/);
});

test("target document digest is independent of field key order", () => {
  assert.equal(sha256({ path: "a/b", fields: { b: sv("2"), a: sv("1") } }), sha256({ fields: { a: sv("1"), b: sv("2") }, path: "a/b" }));
});
