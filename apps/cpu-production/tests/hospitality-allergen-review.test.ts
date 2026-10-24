import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, type OperationalAllergenState } from "../../shared/allergen-contract";
import { completeAllergenReviewMap, confirmAllergenReviewMap } from "../app/lib/allergen-review-state";
import { applyHospitalityCellClick } from "../app/ui/allergen-cell-state";
import { allergenReviewProblems, describeAllergenReviewProblem, effectiveProductionPlanStatus, isProductionPlanMatrixComplete } from "../app/lib/production-plan-state";
import type { PlannedMenuItem } from "../app/lib/production-plan";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const named = CANONICAL_ALLERGEN_KEYS.filter((key) => key !== "no_key_allergens");
const explicit = (state: OperationalAllergenState = "clear") => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map((key) => [key, key === "no_key_allergens" ? "contains" : state]));
const partial = (recorded: string[], state: OperationalAllergenState = "contains") => Object.fromEntries(recorded.map((key) => [key, state]));
const row = (id: string, name: string, allergens: Record<string, OperationalAllergenState>, evidenceStatus: "completed" | "not_completed" = "completed") => ({ id, name, quantity: null, allergens, note: "", evidenceStatus });
const item = (id: string, name: string, subItems: ReturnType<typeof row>[]): PlannedMenuItem => ({ id, name, note: "", subItems });

// The shape of the UAT-20261018 Angel Court record: every row "Checked", several rows only partly recorded.
const uatShaped = [
  item("pots", "Breakfast Pots", [row("pots-1", "Test 1", explicit()), row("pots-2", "Test 2", partial(["peanuts", "tree_nuts", "gluten", "eggs", "milk", "sulphites"]))]),
  item("pastries", "Mini Pastries", [row("pastry", "Mini Pastries", partial(["gluten", "eggs", "milk"]))]),
  item("juice", "Fresh Squeezed & Pressed Juice", [row("juice-1", "OJ", explicit())]),
];

test("a matrix with rows marked Checked but allergens never recorded is incomplete, so it cannot be planned or signed", () => {
  assert.equal(isProductionPlanMatrixComplete(uatShaped), false);
  assert.equal(effectiveProductionPlanStatus({ status: "planned", menuItems: uatShaped }), "planning");
  const problems = allergenReviewProblems(uatShaped);
  const unrecorded = problems.filter((problem) => problem.kind === "allergens-not-recorded");
  assert.deepEqual(unrecorded.map((problem) => problem.rowName), ["Test 2", "Mini Pastries"]);
  assert.ok(unrecorded[0].allergens.includes("Sesame") && unrecorded[0].allergens.includes("Fish") && !unrecorded[0].allergens.includes("Peanuts"), "only the unrecorded allergens are listed");
  assert.equal(unrecorded[0].allergens.length, named.length - 6);
  assert.equal(unrecorded[1].allergens.length, named.length - 3);
  assert.equal(problems.some((problem) => problem.kind === "row-unchecked"), false, "the rows were checked; the real blocker is the unrecorded allergens");
});

test("each requirement is described in plain words naming the item, row and allergens", () => {
  const messages = allergenReviewProblems(uatShaped).map(describeAllergenReviewProblem);
  assert.match(messages[0], /^Breakfast Pots › Test 2: \d+ allergens were never confirmed \(.*Press Mark checked again/);
  assert.ok(messages.some((message) => /Mini Pastries › Mini Pastries: 11 allergens were never confirmed/.test(message)));
});

test("other blockers are reported too: no rows, unnamed items and rows, and unchecked rows", () => {
  const kinds = allergenReviewProblems([
    item("a", "  ", [row("a1", "", explicit(), "not_completed")]),
    item("b", "Empty item", []),
  ]).map((problem) => problem.kind).sort();
  assert.deepEqual(kinds, ["item-unnamed", "no-rows", "row-unchecked", "row-unnamed"].sort());
  assert.equal(allergenReviewProblems([]).length, 1);
});

test("a fully recorded, checked matrix has no outstanding requirements and is complete", () => {
  const complete = [item("a", "Item", [row("a1", "Row", explicit("may_contain")), row("a2", "Row 2", explicit("clear"))])];
  assert.deepEqual(allergenReviewProblems(complete), []);
  assert.equal(isProductionPlanMatrixComplete(complete), true);
  assert.equal(effectiveProductionPlanStatus({ status: "planned", menuItems: complete }), "planned");
});

test("positive and may-contain evidence is preserved and unrecorded allergens are never assumed clear when a row is checked", () => {
  const recorded = { ...partial(["gluten"], "contains"), ...partial(["milk"], "may_contain") } as Record<string, OperationalAllergenState>;
  const result = completeAllergenReviewMap(recorded);
  assert.equal(result.complete, false);
  assert.equal(result.states.gluten, "contains");
  assert.equal(result.states.milk, "may_contain");
  for (const key of named.filter((candidate) => candidate !== "gluten" && candidate !== "milk")) assert.notEqual(result.states[key], "clear", key);
});

test("Mark checked is the explicit row confirmation: white cells become Clear, Contains and May Contain are kept", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /const completion = confirmAllergenReviewMap\(sub\.allergens\);/);
  assert.doesNotMatch(component, /completeAllergenReviewMap\(sub\.allergens\)/);
  const confirmed = confirmAllergenReviewMap({ gluten: "contains", eggs: "contains", milk: "contains", sesame: "may_contain" }).states;
  assert.equal(confirmed.gluten, "contains");
  assert.equal(confirmed.sesame, "may_contain");
  assert.equal(confirmed.fish, "clear");
});

test("live example: Mini Pastries with Gluten, Eggs and Milk selected is confirmed by one Mark checked, with no per-cell clicks", () => {
  const displayed = { gluten: "contains", eggs: "contains", milk: "contains" } as Record<string, OperationalAllergenState>; // the other 11 are visually white
  const before = [item("pastries", "Mini Pastries", [row("pastry", "Mini Pastries", displayed, "not_completed")])];
  assert.deepEqual(allergenReviewProblems(before).map((problem) => problem.kind), ["row-unchecked"], "an untouched row has exactly one requirement: confirm it");
  const confirmed = confirmAllergenReviewMap(displayed).states;
  for (const key of ["gluten", "eggs", "milk"]) assert.equal(confirmed[key], "contains", key);
  for (const key of named.filter((candidate) => !["gluten", "eggs", "milk"].includes(candidate))) assert.equal(confirmed[key], "clear", key);
  assert.equal(confirmed.no_key_allergens, "clear", "derived: key allergens are present");
  const after = [item("pastries", "Mini Pastries", [row("pastry", "Mini Pastries", confirmed)])];
  assert.deepEqual(allergenReviewProblems(after), []);
  assert.equal(isProductionPlanMatrixComplete(after), true);
});

test("an unreviewed row is distinguishable from a confirmed one, and a white cell click declares Contains rather than doing nothing", () => {
  const untouched = row("r", "Row", { gluten: "contains" }, "not_completed");
  assert.equal(untouched.evidenceStatus, "not_completed");
  assert.equal(isProductionPlanMatrixComplete([item("i", "Item", [untouched])]), false);
  const click = applyHospitalityCellClick({ gluten: "contains" }, "fish");
  assert.equal(click.fish, "contains", "white (unconfirmed) behaves as white: first click = Contains");
  assert.equal(applyHospitalityCellClick(click, "fish").fish, "may_contain");
  assert.equal(applyHospitalityCellClick(applyHospitalityCellClick(click, "fish"), "fish").fish, undefined, "third click returns to white (unrecorded), never an explicit Clear");
});

test("legacy rows marked Checked but holding unconfirmed allergens are not converted silently: they need an explicit re-confirmation", () => {
  const legacy = [item("l", "Legacy", [row("l1", "Legacy row", { gluten: "contains" }, "completed")])];
  assert.deepEqual(allergenReviewProblems(legacy).map((problem) => problem.kind), ["allergens-not-recorded"]);
  assert.equal(isProductionPlanMatrixComplete(legacy), false, "the server still never treats missing evidence as clear");
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /unresolvedNamedAllergenKeys\(sub\.allergens\)\.length/);
});

test("the Hospitality sign-off needs an explicit, validated, persisted Save allergen review", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /Save allergen review/);
  assert.doesNotMatch(component, /Save partial plan/);
  assert.doesNotMatch(component, /Planned automatically|Complete every check to plan/);
  // Only the explicit save may mark the plan planned; ticking a row never does.
  assert.equal((component.match(/planCommand\("mark-planned"/g) || []).length, 1);
  assert.doesNotMatch(component, /if \(allComplete\) void planCommand/);
  assert.match(component, /const problems = allergenReviewProblems\(menuItems\)/);
  assert.match(component, /const saved = await planCommand\("save-plan"\);\s*if \(saved\) setMessage\(`Draft saved\./);
  assert.match(component, /catch \{\s*setMessage\("The production plan could not be saved\. Check the connection and try again\."\);\s*return false;/);
  assert.match(component, /const saved = await planCommand\("mark-planned"\);\s*\n?\s*setSavedFingerprint\(savedFingerprintAfterSave\(confirmedFingerprintRef\.current \?\? sentFingerprint, saved\)\)/);
  // Signatures follow persistence of the exact reviewed content.
  assert.match(component, /const signingAvailable = isSigningAvailable\(\{ reviewConflict, effectiveStatus, savedFingerprint, currentFingerprint: reviewFingerprint\(menuItems, planningNotes\) \}\)/);
  assert.match(component, /disabled=\{busy \|\| !signingAvailable\}/);
  assert.match(component, /Save the allergen review to enable signatures/);
});

test("any change after saving withdraws signing and a signed matrix still requires reopening before amendment", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(read("../app/lib/allergen-review-session.ts"), /export function reviewFingerprint/);
  assert.match(component, /const markMatrixEdited = \(\) => \{[\s\S]*?setSignatures\(\[\]\);[\s\S]*?setCurrentAllergenRelease\(undefined\);/);
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /Reopen the allergen review before changing a signed matrix/);
  assert.match(route, /invalidateSignedAllergenAuthorityForNewSourceLineage/);
});

test("Delivered-In keeps its row checkpoint and master-matrix signing contract", () => {
  const matrix = read("../app/ui/AllergenReviewMatrix.tsx");
  assert.match(matrix, /checkpointAllergenReviewRow/);
  const page = read("../app/allergens/page.tsx");
  assert.match(page, /action: "sign-master-matrix"/);
});

test("an outstanding Hub synchronisation is shown from the stored plan on load, without another Save", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /setHubPending\(body\.hubLifecycle\?\.status === "pending"/);
  assert.match(component, /Booking status update not confirmed/);
  assert.match(component, /role="alert" aria-labelledby="matrix-hub-pending-title"/);
});

test("the Hospitality production panel links to this order's own signed allergen checker, found by stable order ID", () => {
  const panel = read("../app/ui/HospitalityProductionDetail.tsx");
  assert.match(panel, /\/api\/production-plan\?orderId=\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(panel, /body\.matrixStatus === "ready" && url/);
  assert.match(panel, /Open signed allergen checker \(PDF\)/);
  assert.match(panel, /rel="noopener noreferrer"/);
  assert.match(panel, /could not be saved to Drive/);
  assert.match(panel, /Not signed yet/);
});

test("once signed, the retry actions also complete a pending Hub Planned sync (idempotent, verified by completeLifecycleSync)", () => {
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /retried\.plan\.lifecycleSync\?\.status === "pending" \? await completeLifecycleSync\(request, retried\.plan\)/);
  assert.match(route, /command\.action === "save-matrix" && plan\.lifecycleSync\?\.status === "pending"\) \? await completeLifecycleSync\(request, plan\)/);
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /if \(body\.hubLifecycle\) setHubPending\(body\.hubLifecycle\.status === "pending"[\s\S]{0,300}const materialized = body\.matrixStatus === "ready"/);
});

test("a signed review with a pending Hub sync offers an explicit Retry booking status update action", () => {
  const component = read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(component, /signatures\.length >= 2 && <button[^>]*onClick=\{\(\) => void retryFinalArtifact\(\)\}>Retry booking status update<\/button>/);
});

test("save-matrix on an already-current release completes a pending Hub sync instead of refusing with 409", () => {
  const route = read("../app/api/production-plan/route.ts");
  assert.match(route, /if \(plan\.lifecycleSync\?\.status === "pending"\) \{\s*const onlyHub = await completeLifecycleSync\(request, plan\);[\s\S]{0,700}This CPU allergen release is already current\./);
});
