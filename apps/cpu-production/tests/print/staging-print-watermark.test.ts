import assert from "node:assert/strict";
import test from "node:test";
import { allergenMatrixHtml } from "../../app/ui/allergen-matrix";
import { addStagingPrintWatermark, STAGING_PRINT_WARNING } from "../../lib/staging-print-watermark";
import { publishedAllergenMatrixHtml } from "../../lib/published-allergen-matrix";

test("staging print watermark repeats in print media and leaves production HTML unchanged", () => {
  const html = "<!doctype html><html><head><title>Fixture</title></head><body><p>Page one</p><div style=\"break-before:page\">Page two</div></body></html>";
  const staging = addStagingPrintWatermark(html, "staging");
  assert.equal((staging.match(new RegExp(STAGING_PRINT_WARNING, "g")) || []).length, 1);
  assert.match(staging, /@top-center\{content:/);
  assert.match(staging, /@top-center\{content:/);
  assert.match(staging, /margin-top:16mm/);
  assert.equal(addStagingPrintWatermark(staging, "staging"), staging, "watermark injection is idempotent");
  assert.equal(addStagingPrintWatermark(html, "production"), html);
});

test("staging CPU allergen matrices carry the print warning; production matrices do not", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  try {
    process.env.FIKA_RUNTIME_MODE = "staging";
    const signedMatrix = allergenMatrixHtml({ requiredBy: "2026-11-09T12:00:00.000Z" }, [], []);
    const publishedMatrix = publishedAllergenMatrixHtml({ dayName: "Monday", date: "2026-11-09", version: 1, contentHash: "fixture-hash", entries: [] });
    assert.match(signedMatrix, new RegExp(STAGING_PRINT_WARNING));
    assert.match(publishedMatrix, new RegExp(STAGING_PRINT_WARNING));
    assert.match(signedMatrix, /fika-staging-print-watermark/);
    assert.match(publishedMatrix, /fika-staging-print-watermark/);

    process.env.FIKA_RUNTIME_MODE = "production";
    assert.doesNotMatch(allergenMatrixHtml({ requiredBy: "2026-11-09T12:00:00.000Z" }, [], []), new RegExp(STAGING_PRINT_WARNING));
    assert.doesNotMatch(publishedAllergenMatrixHtml({ dayName: "Monday", date: "2026-11-09", version: 1, contentHash: "fixture-hash", entries: [] }), new RegExp(STAGING_PRINT_WARNING));
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = previous;
  }
});

test("staging watermark fails closed for non-document print output", () => {
  assert.throws(() => addStagingPrintWatermark("<p>not a document</p>", "staging"), /complete HTML document/);
});