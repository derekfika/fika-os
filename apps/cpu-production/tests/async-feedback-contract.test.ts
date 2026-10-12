import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const matrix = read("../app/ui/AllergenReviewMatrix.tsx");
const page = read("../app/allergens/page.tsx");
const tokens = read("../app/fika-tokens.css");
const review = read("../app/ui/allergen-review.css");

test("allergen review save shows a local spinner status with accurate text and accessible status semantics", () => {
  assert.match(matrix, /reviewSyncStatus === "saving" && <p className="fika-action-status cpu-allergen-sync" role="status" aria-live="polite"><span className="fika-spinner" aria-hidden="true" \/>Saving your review to CPU…<\/p>/);
  assert.match(matrix, /aria-busy=\{reviewSyncStatus === "saving" \? true : undefined\}/);
  assert.match(matrix, /Review saved to CPU\./, "an explicit completion state");
  assert.match(matrix, /role="alert">Review is saved on this device but not yet synchronised to CPU\. <button type="button" onClick=\{retryCheckpoint\}/, "an actionable failure state with retry");
  assert.doesNotMatch(matrix, /<p role="status">Saving review…<\/p>/, "the old static line is gone");
});

test("the status stays in view beside the rows being checked and never claims progress it does not have", () => {
  assert.match(review, /\.cpu-allergen-sync\{position:sticky;top:8px/);
  assert.doesNotMatch(matrix, /Saving your review to CPU…[^<]*\d+\s*%/);
});

test("signing and release status has a spinner and plain-language wording", () => {
  assert.match(page, /signatureBusy && <p className="fika-action-status" role="status" aria-live="polite"><span className="fika-spinner" aria-hidden="true" \/>/);
  assert.doesNotMatch(page, /lineage before retrying pending OPLOC releases/);
  assert.doesNotMatch(page, /Revoking prior signature authority/);
  assert.match(page, /Checking the latest published menu before retrying the pending site releases…/);
});

test("the spinner is hidden under reduced motion so no frozen spinner is left, and the status text remains", () => {
  assert.match(tokens, /\.fika-spinner\{[^}]*animation:fika-spinner-rotate/);
  assert.match(tokens, /@media \(prefers-reduced-motion:reduce\)\{\.fika-spinner\{display:none!important;animation:none!important\}\}/);
});
