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

test("Delivered-In CPU detail routes allergen review to the full-screen checker", () => {
  assert.match(detail, /Open full allergen checker/);
  assert.match(detail, /Acknowledge approved data/);
  assert.match(detail, /report discrepancies/);
  assert.match(detail, /full Delivered-In checker/);
  assert.doesNotMatch(detail, /<td[^>]*onClick/);
  assert.match(detail, /Details \/ technical traceability/);
  assert.match(detail, /allergenHref/);
  assert.doesNotMatch(detail, /allergenHref[^\n]*oploc/);
});

test("CPU allergen review is a full-screen editable signed workflow", () => {
  assert.match(reviewPage, /ALLERGEN REVIEW/);
  assert.match(reviewPage, /URLSearchParams/);
  assert.match(reviewPage, /SignatureModal/);
  assert.match(reviewMatrix, /toggleOperationalAllergen/);
  assert.match(reviewMatrix, /action: \"save-plan\"/);
  assert.match(reviewMatrix, /Mark checked/);
  assert.doesNotMatch(reviewMatrix, /Acknowledge approved data|Save CPU review|Mark ready for signature/);
  assert.match(reviewPage, /action: \"sign-matrix\"/);
  assert.match(reviewMatrix, /row\.snapshot/);
  assert.match(reviewPage, /order\.origin === "menu_planning"/);
  assert.doesNotMatch(reviewPage, /Production source/);
  assert.doesNotMatch(reviewMatrix, />Source<|>Published menu</);
  assert.match(reviewMatrix, /function displayState\(/);
  assert.match(reviewMatrix, /key === "no_key_allergens"\) return namedAllergenPresent \? "clear" : "contains"/);
  assert.match(reviewMatrix, /disabled=\{busy \|\| locked \|\| key === "no_key_allergens"\}/);
  assert.doesNotMatch(reviewMatrix, /states\[row\.key\]\?\.\[key\] \|\| "clear"/);
  assert.match(reviewPage, /deliveredInMenuOrdersForServiceDate/);
  assert.match(reviewPage, /Return to All sites to review and sign the complete Delivered-In master matrix/);
  assert.match(reviewPage, /disabled=\{Boolean\(site\) \|\| signatureBusy/);
});
