import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allergenCheckerView, safeDriveLink } from "../lib/allergen-checker-view";

const signed = { state: "signed" as const, driveUrl: "https://drive.google.com/file/d/abc/view", fileName: "AdHoc-UAT.pdf", signedAt: "2026-10-24T10:00:00.000Z", signers: [{ role: "production_chef" as const, name: "Chef A" }, { role: "head_chef_site_manager" as const, name: "Chef B" }] };

test("not signed shows no link and says what to expect", () => {
  for (const checker of [undefined, { state: "not_signed" as const }]) {
    const view = allergenCheckerView(checker);
    assert.equal(view.tone, "pending");
    assert.equal(view.label, "Not yet signed");
    assert.equal(view.link, undefined);
  }
});

test("a signed checker shows who signed, when, and a link to the PDF", () => {
  const view = allergenCheckerView(signed, () => "24 Oct, 11:00");
  assert.equal(view.tone, "signed");
  assert.equal(view.label, "Signed by Chef A and Chef B on 24 Oct, 11:00");
  assert.equal(view.link, signed.driveUrl);
  assert.equal(view.detail, "AdHoc-UAT.pdf");
});

test("a withdrawn checker never carries a link, even if one is sent", () => {
  const view = allergenCheckerView({ state: "withdrawn", driveUrl: signed.driveUrl, reason: "The order was amended after it was signed." });
  assert.equal(view.tone, "withdrawn");
  assert.equal(view.link, undefined);
  assert.match(view.detail || "", /amended after it was signed/);
});

test("only https Google Drive/Docs links are ever rendered", () => {
  assert.ok(safeDriveLink("https://drive.google.com/file/d/abc/view"));
  assert.ok(safeDriveLink("https://docs.google.com/document/d/abc"));
  for (const bad of ["http://drive.google.com/file/d/abc", "https://evil.example.com/x", "javascript:alert(1)", "https://drive.google.com.evil.example/x", "", undefined]) assert.equal(safeDriveLink(bad as string | undefined), undefined, String(bad));
  const view = allergenCheckerView({ ...signed, driveUrl: "https://evil.example.com/x" });
  assert.equal(view.link, undefined);
  assert.match(view.detail || "", /Ask CPU/);
});

test("the request page renders the checker only for sent requests and opens links safely", () => {
  const form = readFileSync(new URL("../app/order-form.tsx", import.meta.url), "utf8");
  assert.match(form, /request && isSent\(request\) && \(\(\) => \{ const view = allergenCheckerView\(/);
  assert.match(form, /rel="noopener noreferrer"/);
  assert.doesNotMatch(readFileSync(new URL("../lib/allergen-checker-view.ts", import.meta.url), "utf8"), /dangerouslySetInnerHTML/);
});
