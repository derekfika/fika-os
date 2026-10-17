import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPlan, assertApproval, buildPlan, firestoreValue, menuCatalogueSourceIdentity, sha256, validateJournal, validateResumableDestination, verifyFinalDestination, verifySavedPlan } from "./engine.mjs";

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

test("inventory timestamp is excluded from planHash and current Menu Planning head is retained", () => {
  const dish = { canonicalId: "dish:1", name: "current source" };
  const expectedHash = sha256({ schemaVersion: 1, items: [dish] });
  const data = source([record("fikaMenuPlanningCatalogueManifests/catalogue", { sourceHash: sv(expectedHash) }), record("fikaMenuPlanningCatalogue/dish:1", { kind: sv("dish"), record: { mapValue: { fields: { canonicalId: sv("dish:1"), name: sv("current source") } } } })]);
  const first = buildPlan({ ...data, generatedAt: "2026-10-17T00:00:00Z" }, destination([]));
  const second = buildPlan({ ...data, generatedAt: "2026-10-17T01:00:00Z" }, destination([]));
  assert.equal(first.planHash, second.planHash);
  assert.equal(first.retainedCount, 2);
  assert.equal(first.excludedCount, 0);
  assert.equal(first.actions.find(item => item.path === "fikaMenuPlanningCatalogueManifests/catalogue").action, "create");
  assert.equal(first.menuCatalogue.sourceRecordCount, 1);
  assert.equal(first.menuCatalogue.matchesHead, true);
  assert.deepEqual(first.invariantProblems, []);
});

test("Menu Planning source identity matches publisher semantics and ignores sandwiches", () => {
  const dish = { canonicalId: "dish:1", name: "Dish" };
  const sandwich = { canonicalId: "sandwich:1", name: "Sandwich" };
  const encode = value => {
    if (value === null) return { nullValue: null };
    if (typeof value === "string") return sv(value);
    if (typeof value === "number") return { integerValue: String(value) };
    if (typeof value === "boolean") return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) } };
  };
  const result = menuCatalogueSourceIdentity([
    record("fikaMenuPlanningCatalogue/dish:1", { kind: sv("dish"), record: encode(dish) }),
    record("fikaMenuPlanningCatalogue/sandwich:1", { kind: sv("sandwich"), record: encode(sandwich) }),
  ]);
  assert.equal(result.sourceRecordCount, 1);
  assert.equal(result.nonDishRecordCount, 1);
  assert.equal(result.sourceHash, sha256({ schemaVersion: 1, items: [dish] }));
});

test("requires both explicit hash approvals and zero invariant problems", () => {
  const plan = buildPlan(source([record("authmodApplications/hub", { id: sv("hub") })]), destination([]));
  assert.throws(() => assertApproval(plan, { apply: false, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }), /--apply/);
  assert.throws(() => assertApproval(plan, { apply: true, planHash: plan.planHash }, {}), /APPROVED_PLAN_HASH/);
  assert.doesNotThrow(() => assertApproval(plan, { apply: true, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }));
  const broken = { ...plan, invariantProblems: ["problem"] };
  assert.throws(() => assertApproval(broken, { apply: true, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }), /invariantProblems/);
});

test("saved plan approval binds the exact body and blocks the synthetic excluded-booking attack before writes", async () => {
  const approved = buildPlan(source([record("integrationHubCanonical/item:1", { entityType: sv("Hospitality Menu Item") })]), destination([]));
  const env = { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: approved.planHash };
  const args = { apply: true, planHash: approved.planHash };
  const tamperCases = [
    body => { body.actions[0].path = "fikaBookings/excluded"; },
    body => { body.transforms[0].operations.push("retain staging UID"); },
    body => { body.exclusionRules[0].roots.push("integrationHubCanonical"); },
    body => { body.destinationProject = "attacker-project"; },
    body => { body.sourceHash = "0".repeat(64); },
  ];
  for (const tamper of tamperCases) {
    const saved = structuredClone(approved);
    const { planHash, ...body } = saved;
    tamper(body);
    const forged = { ...body, planHash };
    let writes = 0;
    const adapters = { async createDestination() { writes++; } };
    assert.throws(() => verifySavedPlan(forged, approved, args, env), /does not match/);
    assert.equal(writes, 0);
  }
  const changedSource = buildPlan(source([record("integrationHubCanonical/item:1", { entityType: sv("changed source") })]), destination([]));
  assert.throws(() => verifySavedPlan(approved, changedSource, args, env), /differs from the freshly generated/);
  const attack = structuredClone(approved);
  attack.actions.push({ path: "fikaBookings/excluded", action: "create", sourceHash: "a", targetHash: "b", transforms: [] });
  let writes = 0;
  await assert.rejects((async () => {
    const verified = verifySavedPlan(attack, approved, args, env);
    await applyPlan(verified, { async createDestination() { writes++; } });
  })(), /does not match/);
  assert.equal(writes, 0);
});

test("source inventory hash includes missing-parent placeholders without counting them as documents", () => {
  const complete = buildPlan({ ...source([record("ordinary/doc", {})]), placeholders: [{ path: "orphan/parent" }] }, destination([]));
  assert.equal(complete.sourceDocumentCount, 1);
  assert.deepEqual(complete.sourcePlaceholders, ["orphan/parent"]);
  assert.notEqual(complete.planHash, buildPlan(source([record("ordinary/doc", {})]), destination([])).planHash);
  assert.match(complete.invariantProblems[0], /missing-parent placeholder/);
});

test("CLI recursively traverses showMissing placeholders and verifies the final destination exact set", () => {
  const cli = readFileSync(new URL("./cli.mjs", import.meta.url), "utf8");
  assert.match(cli, /showMissing:\s*"true"/);
  assert.match(cli, /const missing = document\.fields === undefined/);
  assert.match(cli, /listCollectionIds\(project, documentPath\)/);
  assert.match(cli, /verifyFinalDestination\(approvedPlan, destinationAfter\)/);
});

test("final destination verification rejects missing, extra, changed and placeholder paths", () => {
  const path = "integrationHubCanonical/item:final";
  const sourceRecord = record(path, { entityType: sv("Hospitality Menu Item") });
  const plan = buildPlan(source([sourceRecord]), destination([]));
  assert.deepEqual(verifyFinalDestination(plan, destination([sourceRecord])), { verifiedDocumentCount: 1, verifiedPlaceholderCount: 0 });
  assert.throws(() => verifyFinalDestination(plan, destination([])), /missing planned/);
  assert.throws(() => verifyFinalDestination(plan, destination([sourceRecord, record("unexpected/doc", {})])), /unexpected document/);
  assert.throws(() => verifyFinalDestination(plan, destination([record(path, { entityType: sv("changed") })])), /differs from the plan/);
  assert.throws(() => verifyFinalDestination(plan, { ...destination([sourceRecord]), placeholders: [{ path: "orphan/parent" }] }), /missing-parent placeholder/);
});

test("non-empty destination is an apply-blocking invariant even without path collision", () => {
  const plan = buildPlan(source([record("integrationHubCanonical/item:1", {})]), destination([record("unrelatedRoot/doc:1", {})]));
  assert.ok(plan.invariantProblems.includes("initial production bootstrap requires an empty destination inventory"));
  assert.throws(() => assertApproval(plan, { apply: true, planHash: plan.planHash }, { FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH: plan.planHash }), /invariantProblems/);
});

test("journal validation binds project pair, plan and each verified action", () => {
  const plan = buildPlan(source([record("integrationHubCanonical/item:1", {})]), destination([]));
  const action = plan.actions[0];
  const journal = { schema: "fika-firestore-bootstrap-journal.v1", sourceProject: plan.sourceProject, destinationProject: plan.destinationProject, planHash: plan.planHash, entries: { [action.path]: { path: action.path, sourceHash: action.sourceHash, targetHash: action.targetHash, transforms: [], status: "created-and-verified" } } };
  assert.doesNotThrow(() => validateJournal(journal, plan));
  assert.throws(() => validateJournal({ ...journal, destinationProject: "attacker-project" }, plan), /identity/);
  assert.throws(() => validateJournal({ ...journal, entries: { ...journal.entries, "fikaBookings/hidden": { path: "fikaBookings/hidden", status: "created-and-verified" } } }, plan), /unauthorized/);
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
