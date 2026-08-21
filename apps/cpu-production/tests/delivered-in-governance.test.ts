import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const productionDomain = readFileSync(new URL("../../integration-hub/lib/production-domain.ts", import.meta.url), "utf8");
const materialiseRoute = readFileSync(new URL("../../integration-hub/app/api/production/materialise/route.ts", import.meta.url), "utf8");
const publication = readFileSync(new URL("../../menu-planning/lib/menu-publication.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/ui/DeliveredInProductionDetail.tsx", import.meta.url), "utf8");
const reviewPage = readFileSync(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
const reviewMatrix = readFileSync(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");

test("published Menu Planning allergen evidence is carried into canonical CPU lines", () => {
  assert.match(publication, /approvedAllergenSnapshot/);
  assert.match(productionDomain, /approvedAllergenSnapshot/);
  assert.match(materialiseRoute, /approvedAllergenSnapshot/);
  assert.match(productionDomain, /allergenEvidenceStatus: "confirmed"/);
});

test("Delivered-In CPU detail acknowledges snapshots and reports discrepancies without editing source truth", () => {
  assert.match(detail, /Acknowledge approved data/);
  assert.match(detail, /report-allergen-discrepancy/);
  assert.match(detail, /approved allergen snapshot remains unchanged/);
  assert.match(detail, /delivered-in-allergen-matrix/);
  assert.match(detail, /CANONICAL_ALLERGEN_COLUMNS/);
  assert.match(detail, /<table className=\"delivered-in-allergen-table delivered-in-allergen-matrix\">/);
  assert.doesNotMatch(detail, /<td[^>]*onClick/);
  assert.match(detail, /Details \/ technical traceability/);
});

test("CPU allergen review is a full-screen editable signed workflow", () => {
  assert.match(reviewPage, /ALLERGEN REVIEW/);
  assert.match(reviewPage, /URLSearchParams/);
  assert.match(reviewPage, /SignatureModal/);
  assert.match(reviewMatrix, /toggleOperationalAllergen/);
  assert.match(reviewMatrix, /action: \"save-plan\"/);
  assert.match(reviewMatrix, /action: \"mark-planned\"/);
  assert.match(reviewPage, /action: \"sign-matrix\"/);
  assert.match(reviewMatrix, /row\.snapshot/);
  assert.match(reviewPage, /order\.origin === "menu_planning"/);
  assert.doesNotMatch(reviewPage, /Production source/);
  assert.doesNotMatch(reviewMatrix, />Source<|>Published menu</);
});
