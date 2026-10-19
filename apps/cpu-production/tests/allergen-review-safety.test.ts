import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, isCompleteOperationalAllergenMap, normaliseOperationalAllergens, toggleOperationalAllergen, type OperationalAllergenState } from "../../shared/allergen-contract";
import { applyHospitalityCellClick, derivedNoKeyState } from "../app/ui/allergen-cell-state";
import { isSigningAvailable, reviewFingerprint, savedFingerprintAfterSave } from "../app/lib/allergen-review-session";
import { LEGACY_PLAN_REVISION, planRevisionToken, reviewRevisionConflict } from "../app/lib/production-plan-state";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import type { PlannedMenuItem, ProductionPlan } from "../app/lib/production-plan";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const named = CANONICAL_ALLERGEN_KEYS.filter((key) => key !== "no_key_allergens");

// ---------- 1. the derived "No key allergens" indicator is read only and cannot conceal named evidence
const evidence = (): Record<string, OperationalAllergenState> => ({ gluten: "contains", milk: "may_contain" }); // fish is unrecorded

test("clicking the derived No key allergens column does nothing: gluten stays contains, milk stays may contain, fish stays unrecorded", () => {
  const start = evidence();
  let current = start;
  for (let attempt = 0; attempt < 5; attempt += 1) current = applyHospitalityCellClick(current, "no_key_allergens");
  assert.equal(current, start, "the same object comes back: nothing changed");
  assert.deepEqual(current, { gluten: "contains", milk: "may_contain" });
  assert.equal(current.fish, undefined);
});

test("no sequence of clicks on other allergens can turn the recorded evidence into clear, and unrecorded is never assumed clear", () => {
  let current = evidence();
  for (const key of named.filter((candidate) => candidate !== "gluten" && candidate !== "milk" && candidate !== "fish")) current = applyHospitalityCellClick(current, key);
  assert.equal(current.gluten, "contains");
  assert.equal(current.milk, "may_contain");
  assert.equal(current.fish, undefined, "fish was never touched, so it is still unrecorded");
  assert.equal(isCompleteOperationalAllergenMap(current), false);
});

test("the shared cycle used by Delivered-In is unchanged; only the Hospitality entry point blocks the derived column", () => {
  const delivered = toggleOperationalAllergen({ gluten: "contains" }, "no_key_allergens");
  assert.equal(delivered.gluten, "clear", "Delivered-In behaviour (shared contract) is untouched");
  assert.deepEqual(applyHospitalityCellClick({ gluten: "contains" }, "no_key_allergens"), { gluten: "contains" });
});

test("the derived indicator reflects the named states and never alters them", () => {
  assert.equal(derivedNoKeyState(evidence()), "clear", "a positive named allergen means there are key allergens, so the indicator is clear");
  assert.equal(derivedNoKeyState(Object.fromEntries(named.map((key) => [key, "clear"]))), "contains", "all named explicitly clear = no key allergens");
  assert.equal(derivedNoKeyState({ ...Object.fromEntries(named.map((key) => [key, "clear"])), fish: "unrecorded" }), "unrecorded", "one unrecorded named allergen keeps it unrecorded");
  assert.equal(derivedNoKeyState({ ...Object.fromEntries(named.map((key) => [key, "clear"])), fish: "may_contain" }), "clear");
});

test("persistence cannot accept an inconsistent derived value that hides named evidence", () => {
  const forgedClearEverything = normaliseOperationalAllergens({ ...evidence(), no_key_allergens: "contains" });
  assert.equal(forgedClearEverything.gluten, "contains");
  assert.equal(forgedClearEverything.milk, "may_contain");
  assert.equal(forgedClearEverything.no_key_allergens, "clear", "positive named evidence forces the derived value");
  const allClearForged = normaliseOperationalAllergens({ ...Object.fromEntries(named.map((key) => [key, "clear"])), no_key_allergens: "clear" });
  assert.equal(allClearForged.no_key_allergens, "contains", "all named clear forces the derived value");
  const withUnrecorded = normaliseOperationalAllergens({ ...evidence(), no_key_allergens: "contains" });
  assert.equal(isCompleteOperationalAllergenMap(withUnrecorded), false, "an unrecorded named allergen still blocks planning and signing");
});

test("the Hospitality grid renders the derived column as a non-interactive element", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /if \(key === "no_key_allergens"\) return;/);
  assert.match(component, /if \(key === "no_key_allergens"\) \{\s*const derivedState = derivedNoKeyState\(sub\.allergens\);[\s\S]*?<span\s+role="img"[\s\S]*?read only/);
  assert.doesNotMatch(component, /toggleOperationalAllergen\(/, "the component no longer calls the shared toggle directly");
});

// ---------- 2. two reviewers: a stale save is rejected and never overwrites newer evidence
const plan = (revision: string | undefined, note: string): ProductionPlan => ({ id: "production-plan:order-1", orderId: "order-1", status: "planning", menuItems: [], planningNotes: note, audit: [], updatedAt: revision, updatedBy: "test" } as unknown as ProductionPlan);

test("reviewer 1 saves B; reviewer 2, who loaded A, is told it changed and nothing is overwritten", async () => {
  const previousStore = process.env.FIKA_CPU_PLAN_STORE;
  process.env.FIKA_CPU_PLAN_STORE = "memory"; // never touch Firestore from a unit test
  try {
  const repository = createProductionPlanRepository();
  const orderId = "order-1";
  await repository.save(plan("2026-10-18T10:00:00.000Z", "A"), null);
  const loadedByBoth = planRevisionToken(await repository.get(orderId));
  assert.equal(loadedByBoth, "2026-10-18T10:00:00.000Z");

  assert.equal(reviewRevisionConflict(loadedByBoth, await repository.get(orderId)), null);
  await repository.save(plan("2026-10-18T10:05:00.000Z", "B"), loadedByBoth);

  const conflict = reviewRevisionConflict(loadedByBoth, await repository.get(orderId));
  assert.ok(conflict, "reviewer 2's stale token is rejected");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "CPU_ALLERGEN_REVIEW_CONFLICT");
  assert.equal(conflict.currentRevision, "2026-10-18T10:05:00.000Z");
  assert.match(conflict.message, /Copy anything you need, reload the review/);

  // Second, atomic guard: even if the route check were bypassed the write itself refuses the stale revision.
  await assert.rejects(repository.save(plan("2026-10-18T10:06:00.000Z", "stale A"), loadedByBoth), (error: Error & { status?: number }) => error.status === 409);
  assert.equal((await repository.get(orderId))?.planningNotes, "B", "the newer review is untouched");
  } finally {
    if (previousStore === undefined) delete process.env.FIKA_CPU_PLAN_STORE; else process.env.FIKA_CPU_PLAN_STORE = previousStore;
  }
});

const legacyPlan = { updatedAt: undefined } as unknown as Pick<ProductionPlan, "updatedAt">; // a stored plan that pre-dates revision stamps

test("initial creation and legacy plans stay supported, and a newer plan blocks a first-save from a stale 'nothing stored' view", async () => {
  assert.equal(planRevisionToken(undefined), null);
  assert.equal(reviewRevisionConflict(null, undefined), null, "nothing stored and nothing expected: first save is allowed");
  assert.equal(planRevisionToken(legacyPlan), LEGACY_PLAN_REVISION, "a plan that pre-dates revision stamps has a fixed token");
  assert.equal(reviewRevisionConflict(LEGACY_PLAN_REVISION, legacyPlan), null, "the legacy token lets the plan be saved once and be stamped");
  assert.equal(reviewRevisionConflict(null, { updatedAt: "2026-10-18T10:00:00.000Z" })?.status, 409, "someone created the plan after this reviewer loaded 'nothing'");
  assert.equal(reviewRevisionConflict("2026-10-18T09:00:00.000Z", undefined)?.status, 409, "the plan the reviewer loaded no longer exists");
});

test("the server requires the loaded revision, returns it on read, and rejects mismatches before touching the plan", () => {
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /expectedRevision: ExpectedRevision/);
  assert.equal((route.match(/expectedRevision: ExpectedRevision/g) || []).length, 2, "both save-plan and mark-planned require it");
  assert.match(route, /const ExpectedRevision = z\.string\(\)\.min\(1\)\.max\(200\)\.nullable\(\);/);
  assert.match(route, /const revisionConflict = reviewRevisionConflict\(command\.expectedRevision, storedPlan\);[\s\S]*?throw revisionConflict;/);
  assert.match(route, /revision: planRevisionToken\(storedForRevision\)/);
  assert.match(route, /revision: planRevisionToken\(plan\)/);
  // the conflict check happens before the plan is mutated
  assert.ok(route.indexOf("reviewRevisionConflict(command.expectedRevision, storedPlan)") < route.indexOf('if (command.action === "save-plan") {'));
});

// ---------- 3 & 4. signing stays locked after failed saves and for edits made while a save is in flight
const items = (allergens: Record<string, OperationalAllergenState>): PlannedMenuItem[] => [{ id: "i1", name: "Item", note: "", subItems: [{ id: "r1", name: "Row", quantity: null, allergens, note: "", evidenceStatus: "completed" }] }];
const complete = Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map((key) => [key, key === "no_key_allergens" ? "contains" : "clear"])) as Record<string, OperationalAllergenState>;

test("a failed network or server save never unlocks signing", () => {
  const sent = reviewFingerprint(items(complete), "");
  const failed = savedFingerprintAfterSave(sent, false);
  assert.equal(failed, undefined);
  assert.equal(isSigningAvailable({ reviewConflict: false, effectiveStatus: "planned", savedFingerprint: failed, currentFingerprint: sent }), false);
  // A previously saved, now different, review also stays locked after a failed attempt for the new content.
  const older = reviewFingerprint(items({ ...complete, gluten: "contains", no_key_allergens: "clear" }), "");
  assert.equal(isSigningAvailable({ reviewConflict: false, effectiveStatus: "planned", savedFingerprint: older, currentFingerprint: sent }), false);
  // A 409 conflict withdraws signing even for identical content.
  assert.equal(isSigningAvailable({ reviewConflict: true, effectiveStatus: "planned", savedFingerprint: sent, currentFingerprint: sent }), false);
});

test("edits made while a save is in flight keep signing disabled until the latest content is saved", () => {
  const savedContent = items(complete);
  const sent = reviewFingerprint(savedContent, "");
  const editedDuringFlight = reviewFingerprint(items({ ...complete, gluten: "contains", no_key_allergens: "clear" }), "");
  assert.notEqual(sent, editedDuringFlight);
  // The response for the earlier content arrives: it records what was SENT, not what is on screen now.
  const saved = savedFingerprintAfterSave(sent, true);
  assert.equal(isSigningAvailable({ reviewConflict: false, effectiveStatus: "planned", savedFingerprint: saved, currentFingerprint: editedDuringFlight }), false);
  // Only after the newer content is itself saved successfully is signing offered.
  const savedLatest = savedFingerprintAfterSave(editedDuringFlight, true);
  assert.equal(isSigningAvailable({ reviewConflict: false, effectiveStatus: "planned", savedFingerprint: savedLatest, currentFingerprint: editedDuringFlight }), true);
  // Planning notes and may-contain notes are part of the reviewed content too.
  assert.notEqual(sent, reviewFingerprint(savedContent, "new planning note"));
});

test("the component takes the fingerprint from what was sent, adopts the revision only from a successful response, and stops on conflict", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /const sentFingerprint = reviewFingerprint\(menuItems, planningNotes\);\s*\n\s*const saved = await planCommand\("mark-planned"\);\s*\n\s*setSavedFingerprint\(savedFingerprintAfterSave\(confirmedFingerprintRef\.current \?\? sentFingerprint, saved\)\);/);
  assert.match(component, /expectedRevision: planRevisionRef\.current,/);
  assert.match(component, /adoptRevision\(body\.revision === undefined \? \(body\.plan\?\.updatedAt \?\? null\) : body\.revision\);[\s\S]{0,1800}?setPlanStatus\(/);
  assert.match(component, /response\.status === 409 && body\.error\?\.code === "CPU_ALLERGEN_REVIEW_CONFLICT"[\s\S]*?setReviewConflict\(true\);[\s\S]*?setSavedFingerprint\(undefined\);/);
  assert.match(component, /The production plan could not be saved\. Check the connection and try again\./, "a network failure returns false and clears busy");
  assert.match(component, /Reload latest review/);
  assert.match(component, /if \(busy \|\| reviewLockedByAuthority \|\| reviewConflict\) return;/);
});

// ---------- 5. source-lineage and amendment invalidation remain in force
test("amendment and source-lineage changes still revoke signatures and require a fresh review", () => {
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /invalidateSignedAllergenAuthorityForNewSourceLineage\(plan, auditActor, timestamp, "The allergen matrix or source lineage changed after signed release\."\)/);
  assert.match(route, /prior signed allergen authority cannot transfer to the replacement source lineage/);
  assert.match(route, /Reopen the allergen review before changing a signed matrix/);
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /const markMatrixEdited = \(\) => \{[\s\S]*?setSignatures\(\[\]\);[\s\S]*?setCurrentAllergenRelease\(undefined\);[\s\S]*?setPlanStatus\("planning"\);/);
  assert.notEqual(reviewFingerprint(items(complete), ""), reviewFingerprint(items({ ...complete, milk: "may_contain" }), ""), "an amended allergen changes the reviewed content, so the old saved review no longer matches");
});
