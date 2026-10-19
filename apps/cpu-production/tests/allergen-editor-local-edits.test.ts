import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveMatrixStorageStatus, hasUnsavedEdits, MATRIX_POLL_INTERVAL_MS, reviewFingerprint } from "../app/lib/allergen-review-session";
import type { PlannedMenuItem } from "../app/lib/production-plan";

const component = readFileSync(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
const item = (name: string): PlannedMenuItem => ({ id: "i", name: "Item", note: "", subItems: [{ id: "s", name, quantity: 1, allergens: {}, note: "", evidenceStatus: "not_completed" }] });

test("edits stay local: the only plan commands the editor can send are the explicit Save allergen review (draft save or mark-planned)", () => {
  const callSites = [...component.matchAll(/planCommand\("(save-plan|mark-planned)"/g)].map((match) => match[1]);
  assert.deepEqual(callSites.sort(), ["mark-planned", "save-plan"], "exactly the two calls inside saveAllergenReview; no autosave from rows, items or pickers");
  // Picking a saved menu item only updates local state.
  const apply = component.slice(component.indexOf("const applySandwich"), component.indexOf("const saveSandwich"));
  assert.match(apply, /setMenuItems\(nextItems\)/);
  assert.doesNotMatch(apply, /planCommand|fetch\(/);
  // Row edits (cells, checks, names, notes) never write either.
  for (const handler of ["const toggleCell", "const completeSubItem", "const updateSubItem", "const addRows", "const removeMenuItem"]) {
    const start = component.indexOf(handler);
    if (start < 0) continue;
    assert.doesNotMatch(component.slice(start, start + 900).split("\n  const ")[0], /planCommand|fetch\(/, handler);
  }
});

test("after Save the editor adopts the server-confirmed lineage, revision and content, so the first signature needs no refresh", () => {
  assert.match(component, /if \(body\.signingLineage\) setSigningLineage\(body\.signingLineage\);/);
  assert.match(component, /latestFingerprintRef\.current === sentFingerprint/);
  assert.match(component, /confirmedFingerprint = reviewFingerprint\(serverItems, body\.plan\.planningNotes \|\| ""\);/);
  assert.match(component, /confirmedFingerprintRef\.current = confirmedFingerprint;/);
  // Both signatures adopt the lineage the server returns.
  assert.equal((component.match(/if \(body\.signingLineage\) setSigningLineage\(body\.signingLineage\);/g) || []).length >= 3, true, "save, sign and poll");
});

test("unsaved edits are detected against the last server-confirmed content and warn before discarding", () => {
  const clean = reviewFingerprint([item("A")], "");
  assert.equal(hasUnsavedEdits(undefined, clean), false, "nothing loaded yet: no warning");
  assert.equal(hasUnsavedEdits(clean, clean), false);
  assert.equal(hasUnsavedEdits(clean, reviewFingerprint([item("B")], "")), true);
  assert.equal(hasUnsavedEdits(clean, reviewFingerprint([item("A")], "a note")), true);
  assert.match(component, /const requestClose = \(\) => \{ if \(dirty\) setConfirmDiscard\(true\); else close\(\); \};/);
  assert.equal((component.match(/onClick=\{requestClose\}/g) || []).length, 2, "both close controls are guarded");
  assert.doesNotMatch(component, /onClick=\{close\}/);
  assert.match(component, /window\.addEventListener\("beforeunload", warn\)/);
  assert.match(component, /role="alertdialog" aria-labelledby="matrix-discard-title"/);
});

test("the signed PDF shows Pending, Ready or Failed and is re-checked about every 30 seconds while pending", () => {
  assert.equal(MATRIX_POLL_INTERVAL_MS, 30_000);
  const signed = { signatures: [{}, {}] };
  assert.equal(deriveMatrixStorageStatus({ plan: { signatures: [{}] } }), undefined, "nothing before both signatures persist");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "generating", plan: signed }), "artifact_pending");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "failed", plan: signed }), "artifact_failed");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "ready", plan: { ...signed, matrixArtifact: { driveUrl: "x" } } }), "ready");
  const staleArtifact = { driveUrl: "old" };
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "failed", plan: { ...signed, matrixArtifact: staleArtifact } }), "artifact_failed", "a stored old artifact cannot hide failure for the current release");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "generating", plan: { ...signed, matrixArtifact: staleArtifact } }), "artifact_pending", "a stored old artifact cannot make the current release ready");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "ready", plan: signed }), "artifact_pending", "ready requires a current artifact");
  assert.equal(deriveMatrixStorageStatus({ matrixStatus: "not_configured", plan: signed }), "not_configured");
  assert.match(component, /if \(matrixStorageStatus !== "artifact_pending"\) return;/);
  assert.match(component, /window\.setInterval\([\s\S]*?MATRIX_POLL_INTERVAL_MS\)/);
  assert.match(component, /return \(\) => \{ active = false; window\.clearInterval\(timer\); \};/);
  assert.match(component, /matrixStorageStatus !== "ready" \|\| !matrixArtifact\?\.driveUrl/);
});

test("the PDF is generated by the server after the response (durable outbox event), not by the browser or the request", () => {
  const route = readFileSync(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /await runAfterResponse\(async \(\) => \{\s*try \{\s*const delivered = await deliverCpuPropagation\(materializationEventId\);/);
  assert.doesNotMatch(route, /materializationResult = await deliverCpuPropagation/);
  assert.match(route, /try \{ after\(task\); \} catch \{ await task\(\); \}/);
});
