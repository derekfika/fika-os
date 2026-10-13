import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const block = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from) + from.length));

test("user-facing language: 'UR' is replaced by 'Not checked'; the underlying unrecorded state is untouched", async () => {
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.doesNotMatch(detail, /"UR"/);
  assert.match(detail, /Not checked/);
  assert.match(detail, /displayAllergenMap\(sub\.allergens\)\[key\]/);
  const helper = await read("../app/ui/allergen-review-persistence.ts");
  assert.match(helper, /unrecorded: "not checked"/);
  assert.match(helper, /\|\| "unrecorded"/, "an omitted allergen is displayed as not checked; the state itself is still `unrecorded`");
  assert.doesNotMatch(helper, /\|\| "clear"/, "nothing is ever defaulted to clear");
});

test("Save partial plan is gone; edits persist through the existing coalescer, save-plan and mark-planned with idempotent command IDs", async () => {
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  const helper = await read("../app/ui/allergen-review-persistence.ts");
  assert.doesNotMatch(detail, /Save partial plan|Mark as Planned/);
  assert.match(helper, /import \{ createSaveCoalescer \} from "\.\/allergen-save-coalescer"/);
  assert.match(helper, /ALLERGEN_AUTOSAVE_DEBOUNCE_MS = 800/);
  assert.match(detail, /commandId: `autosave:\$\{order\.canonicalId\}:\$\{sessionId\.current\}:\$\{revision\}`/);
  assert.match(detail, /action = autosaveAction\(payload\.menuItems\)/);
  assert.match(detail, /Saving…/); assert.match(detail, /"Saved"|All changes saved/); assert.match(detail, /Retry save/);
  // a row check saves immediately; ordinary edits use the debounce
  assert.match(detail, /edit\(result\.items, planningNotesRef\.current, true\)/);
  // no network work is attempted while the page unloads: only the normal browser unsaved-changes prompt
  assert.match(detail, /addEventListener\("beforeunload"/);
  assert.doesNotMatch(detail, /sendBeacon|keepalive/);
  // in-app close flushes and awaits pending work first
  assert.match(block(detail, "const handleClose", "const confirmReopen"), /await autosaveRef\.current\.flush\(\)[\s\S]*onSaved\(false\)[\s\S]*close\(\)/);
  // the server contract is unchanged: autosave uses the existing commands only
  assert.doesNotMatch(detail, /action: "autosave"/);
});

test("signing: the button flushes pending saves, re-evaluates the gate against saved state, and the server lineage check is still the final boundary", async () => {
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  const request = block(detail, "const requestSigning", "const handleClose");
  assert.match(request, /await autosaveRef\.current\.flush\(\)/);
  assert.match(request, /signingGate\(\{ menuItems: menuItemsRef\.current, persistence: autosaveRef\.current\.state\.status, serverPlanStatus: serverStatusRef\.current/);
  assert.ok(request.indexOf("flush()") < request.indexOf("setSigningRole(role)"), "the dialog opens only after the flush and the gate");
  assert.match(detail, /onClick=\{\(\) => void requestSigning\(role\)\}/);
  assert.doesNotMatch(detail, /onClick=\{\(\) => \{ setSigningError\(""\); setSigningRole\(role\); \}\}/);
  const sign = block(detail, "const signMatrix", "const accept");
  assert.match(sign, /autosaveRef\.current\.state\.status !== "saved" \|\| fullySignedRef\.current/);
  // a partly signed matrix is locked for editing but stays signable for the missing role
  assert.match(detail, /readOnlyBlocksSigning\(menuItems, fullySigned, autosave\.status\)/);
  assert.match(detail, /readOnly: fullySignedRef\.current/);
  assert.match(sign, /action: "sign-matrix"/); assert.match(sign, /expectedLineage/);
  assert.match(sign, /reviewedLineage\(order, menuItems, signingLineage\)/);
  // the server-side lineage/hash validation is untouched
  const route = await read("../app/api/production-plan/route.ts");
  assert.match(route, /CPU_SIGN_LINEAGE_CONFLICT/);
  assert.match(route, /assertAllergenMatrixComplete\(plan\.menuItems, "signing the matrix"\)/);
});

test("read-only: every content mutation is guarded, cells and fields are inert, and viewing can never clear a signature", async () => {
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(detail, /const readOnly = reviewLockedByAuthority/);
  assert.match(detail, /hasAllergenAuthority\(\{ signatures, matrixArtifact, currentAllergenRelease \}\)/);
  const mutators = block(detail, "const edit = (next", "const saveSandwich");
  assert.match(mutators, /if \(readOnlyRef\.current\) return;/);
  for (const name of ["updateMenuItem", "updateSubItem", "addMenuItem", "addRows", "removeSubItem", "removeMenuItem", "toggleCell"]) assert.match(mutators, new RegExp(`const ${name} =[\\s\\S]*?mutate\\(`), `${name} goes through the guarded mutate`);
  assert.match(detail, /if \(readOnlyRef\.current\) return; \/\/ the sandwich library is not mutated from a signed matrix/);
  assert.match(detail, /readOnly \? \([\s\S]*role="img"[\s\S]*allergen-cell--static/, "read-only cells are static, not buttons");
  for (const attribute of ["readOnly={readOnly}", "disabled={readOnly}"]) assert.ok(detail.split(attribute).length > 5, `${attribute} is applied across the inputs and actions`);
  // no local path clears approval state because of an edit; the only clear is after the server-confirmed reopen
  assert.doesNotMatch(detail, /markMatrixEdited/);
  assert.equal(detail.split("setSignatures([])").length - 1, 1);
  assert.equal(detail.split("setCurrentAllergenRelease(undefined)").length - 1, 1);
  assert.ok(detail.indexOf("setSignatures([])") > detail.indexOf("!response.ok || !result?.ok"), "cleared only after the server reports success");
  // autosave is switched off the moment the matrix is read-only
  assert.match(detail, /autosaveRef\.current\.setReadOnly\(readOnly\)/);
});

test("reopen: explicit in-app confirmation, then the canonical production-plan reopen-review command; the warning covers every consequence", async () => {
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  const reopen = block(detail, "const confirmReopen", "const applyReusedAuthority");
  assert.match(reopen, /action: "batch-plan", operations: \[\{ action: "reopen-review", orderId: order\.canonicalId/);
  assert.match(detail, /Reopen allergen review/);
  assert.match(detail, /ReopenReviewDialog/);
  assert.doesNotMatch(detail, /window\.(confirm|alert|prompt)|\bconfirm\(|\balert\(/);
  for (const text of ["no longer be valid", "Both chef roles", "any shared approval created from this matrix is revoked", "other bookings that relied on it will need an allergen review", "reused approval will be withdrawn"]) assert.ok(detail.toLowerCase().includes(text.toLowerCase()), `warning mentions: ${text}`);
  assert.match(detail, /role="alertdialog" aria-modal="true"/);
  assert.match(detail, /event\.key === "Escape"/);
  // it reuses the one canonical server implementation: the reopen operation, its invalidation and revocation are not re-implemented
  const route = await read("../app/api/production-plan/route.ts");
  assert.match(route, /z\.literal\("reopen-review"\)/);
  assert.equal((route.match(/invalidateSignedAllergenAuthorityForNewSourceLineage\(plan, auditActor, timestamp, "The allergen review was explicitly reopened for amendment\."\)/g) || []).length, 1);
  assert.doesNotMatch(detail, /revokeCpuAllergenRelease|invalidateSignedAllergenAuthority/);
});

test("viewing: the order detail offers Review allergens / View allergen matrix and the editor shows approval provenance and the signed artifact", async () => {
  const orderDetail = await read("../app/ui/ProductionOrderDetail.tsx");
  assert.match(orderDetail, /"View allergen matrix" : "Review allergens"/);
  assert.match(orderDetail, /signatures\?\.length \|\| body\.plan\.currentAllergenRelease \|\| body\.plan\.matrixArtifact/);
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(detail, /Allergen matrix approved/); assert.match(detail, /Partly approved/);
  assert.match(detail, /View signed matrix/); assert.match(detail, /approvedBy\.join/);
  assert.match(detail, /Approved by reuse of a previously signed sandwich set \(not signed for this booking\)/);
  assert.match(detail, /All allergens reviewed|reviewStatusCopy/);
});

test("accessibility and motion contracts for the new surfaces", async () => {
  const css = await read("../app/ui/hospitality-allergen-detail.css");
  assert.match(css, /\.allergen-cell:focus-visible[^{]*\{outline:3px solid var\(--fika-focus-ring/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{[^}]*\.fika-spinner\{display:none!important/);
  assert.match(css, /\.allergen-cell--unrecorded\{background:var\(--fika-status-warning-surface/);
  const detail = await read("../app/ui/HospitalityAllergenDetail.tsx");
  assert.match(detail, /role=\{autosave\.status === "error" \? "alert" : "status"\} aria-live="polite"/);
  assert.match(detail, /className="fika-spinner" aria-hidden="true"/);
  assert.match(detail, /aria-label=\{cellLabel\}/);
});

test("allergen, signing, generation, release and authority semantics are untouched by this UX change", async () => {
  // only UI files and tests changed; the server/lib that own those semantics are not part of this change
  for (const path of ["../app/api/production-plan/route.ts", "../lib/allergen-composition.ts", "../lib/allergen-authority-store.ts", "../lib/cpu-allergen-release.ts", "../lib/allergen-reuse-orchestrator.ts"]) {
    const source = await read(path);
    assert.doesNotMatch(source, /allergen-review-persistence|autosave:\$\{/, `${path} has no knowledge of the UI persistence layer`);
  }
});
