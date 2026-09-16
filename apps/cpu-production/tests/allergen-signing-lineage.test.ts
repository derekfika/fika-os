import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captureSigningLineage, type MatrixLineage } from "../app/allergens/signing-lineage";

const lineage = (orderId: string, matrixContentHash: string): MatrixLineage => ({
  productionOrderId: orderId,
  serviceDate: "2026-09-14",
  sourceDayId: "menu-day:2026-09-14",
  sourcePublicationId: "menu-publication:7",
  sourcePublicationDayId: "menu-publication-day:7:2026-09-14",
  sourceVersion: 7,
  sourceContentHash: "a".repeat(64),
  matrixContentHash,
});

test("post-save signing snapshot captures fresh lineage for every master OPLOC", () => {
  const initial = lineage("order:haleon", "b".repeat(64));
  const freshHaleon = lineage("order:haleon", "c".repeat(64));
  const freshXchange = lineage("order:xchange", "d".repeat(64));
  const snapshot = captureSigningLineage(
    ["order:haleon", "order:xchange"],
    "2026-09-14",
    [
      { orderId: initial.productionOrderId, sourceLineage: freshHaleon },
      { orderId: freshXchange.productionOrderId, sourceLineage: freshXchange },
    ],
  );
  assert.equal(snapshot["order:haleon"]?.matrixContentHash, freshHaleon.matrixContentHash);
  assert.equal(snapshot["order:xchange"]?.matrixContentHash, freshXchange.matrixContentHash);
  assert.notEqual(snapshot["order:haleon"]?.matrixContentHash, initial.matrixContentHash);
});

test("signing snapshot fails closed when a master OPLOC lineage is missing or moved", () => {
  assert.throws(
    () => captureSigningLineage(["order:haleon", "order:xchange"], "2026-09-14", [{ orderId: "order:haleon", sourceLineage: lineage("order:haleon", "b".repeat(64)) }]),
    /lineage is unavailable/,
  );
  assert.throws(
    () => captureSigningLineage(["order:haleon"], "2026-09-14", [{ orderId: "order:haleon", sourceLineage: { ...lineage("order:haleon", "b".repeat(64)), serviceDate: "2026-09-15" } }]),
    /lineage is unavailable/,
  );
});

test("the master sign command refreshes lineage after the authoritative save and signs from the snapshot", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const save = page.indexOf("await saveReviewRef.current()");
  const refresh = page.indexOf("const freshLineage = captureSigningLineage", save);
  const openModal = page.indexOf("setSigning({ role })", refresh);
  const fanOut = page.indexOf("const expectedLineage = signingSnapshot[order.canonicalId]");
  assert.ok(save >= 0 && refresh > save && openModal > refresh && fanOut >= 0);
  assert.match(page, /signingSnapshotRef/);
  assert.match(page, /matrixStatus=1&orderIds=/);
});

test("the backend still rejects a genuine lineage advance after the client refresh", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!sameLineage\(currentSignatureScope, command\.expectedLineage\)\)[\s\S]*CPU_SIGN_LINEAGE_CONFLICT/);
  assert.match(route, /latestScopeForSign[\s\S]*sameLineage\(latestScopeForSign, command\.expectedLineage\)/);
});

test("review edits remain local and explicit save is serialized before first signing", async () => {
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(matrix, /dirtyRef/);
  assert.match(matrix, /onDirtyChange/);
  assert.match(matrix, /authoritativeReviewedRef/);
  assert.match(matrix, /if \(!dirtyRef\.current && authoritativeReviewedRef\.current\) return/);
  assert.match(matrix, /startSave/);
  assert.doesNotMatch(matrix, /pendingSave|scheduleSync|setTimeout\(/);
  assert.match(matrix, /if \(inFlightSave\.current\) \{[\s\S]*await inFlightSave\.current/);
});

test("post-sign hydration keeps the committed role locked and semantic no-op saves cannot revoke authority", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /const \[hydrating, setHydrating\] = useState\(false\)/);
  assert.match(page, /locked=\{hydrating \|\| reviewFrozen \|\| bothSigned \|\| Boolean\(signing\)\}/);
  assert.match(matrix, /onHydrationChange\?\.\(true\)/);
  assert.match(matrix, /onHydrationChange\?\.\(false\)/);
  assert.match(route, /const noOpSave = Boolean\(storedPlan && operation\.action === "save-plan" && !contentChanged && plan\.planningNotes === operation\.planningNotes && authorityMatches\)/);
  assert.doesNotMatch(route, /if \(contentChanged \|\| plan\.currentAllergenRelease\) invalidateSignedAllergenAuthority/);
});

test("review session saves only once when dirty, never resaves between signatures, and supports explicit amendment", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const toggle = matrix.slice(matrix.indexOf("  const toggle ="), matrix.indexOf("\n\n  return (", matrix.indexOf("  const toggle =")));
  assert.equal(toggle.includes("fetch("), false);
  assert.equal(toggle.includes("startSave"), false);
  assert.match(matrix, /dirtyRef\.current = true/);
  assert.equal((matrix.match(/action: \"batch-plan\"/g) || []).length, 1);
  assert.equal((matrix.match(/await submit\(action\)/g) || []).length, 1);
  assert.match(matrix, /await startSave\(states, \"mark-planned\"\)/);
  assert.match(page, /await saveReviewRef\.current\(\);/);
  assert.match(page, /if \(!reviewFrozen\) \{/);
  assert.match(page, /const refreshReviewStatus = async/);
  assert.match(page, /await refreshReviewStatus\(\)/);
  assert.doesNotMatch(page, /load\(date, \{ resetSession: false \}\)/);
  assert.match(page, /const frozenLineage = signingSnapshotRef\.current/);
  assert.match(page, /sameLineage\(frozenLineage\[orderId\], freshLineage\[orderId\]\)/);
  assert.match(page, /const reopenForAmendment = async/);
  assert.match(page, /action: "reopen-review"/);
  assert.match(route, /action: z\.literal\("reopen-review"\)/);
  assert.match(route, /allergen-review-reopened/);
  assert.match(route, /invalidateSignedAllergenAuthorityForNewSourceLineage\(plan, auditActor, timestamp, "The allergen review was explicitly reopened for amendment\."\)/);
});

test("live clean-but-unreviewed state requires one authoritative completion, while exact reviewed state is a no-op", async () => {
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(matrix, /reviewed: boolean/);
  assert.match(matrix, /const authoritativeReviewed = allStatusesPresent && statuses\.every\(status => status\.reviewed\)/);
  assert.match(matrix, /authoritativeReviewedRef\.current = authoritativeReviewed/);
  assert.match(matrix, /evidenceStatus: action === "mark-planned" \? "completed"/);
  assert.match(matrix, /body: JSON\.stringify\(\{ action: "batch-plan", operations: orders\.map/);
});

test("signing uses an attempt-scoped idempotency key and confirms authority after fan-out", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /signingAttemptRef/);
  assert.match(page, /crypto\.randomUUID\(\)/);
  assert.match(page, /const commandId = \["cpu-master-sign", signingAttempt\.id, role, order\.canonicalId\]/);
  assert.match(page, /roleAuthoritativelyPresent/);
  assert.match(page, /authoritative matrix status did not confirm/);
  assert.match(route, /CPU_SIGN_IDEMPOTENCY_CONFLICT/);
  assert.match(route, /hasExactSignature\(plan, command\.role, currentScope\)/);
  assert.match(route, /!event\.duplicate/);
});

test("master page retries only non-ready OPLOC releases with fresh lineage", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const retryStart = page.indexOf("const retryPendingOplocReleases = async () =>");
  const retryEnd = page.indexOf("const sign = async", retryStart);
  const retryBlock = page.slice(retryStart, retryEnd);
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.match(page, /Retry pending OPLOC releases/);
  assert.match(page, /const pendingReleaseOrders = useMemo/);
  assert.match(page, /matrixStatusByOrderId\[order\.canonicalId\] !== "ready"/);
  assert.match(retryBlock, /await refreshReviewStatus\(\)/);
  assert.match(retryBlock, /matrixStatus !== "ready"/);
  assert.match(retryBlock, /action: "save-matrix"/);
  assert.match(retryBlock, /expectedLineage/);
  assert.match(retryBlock, /const final = await refreshReviewStatus\(\)/);
  assert.doesNotMatch(retryBlock, /action: "sign-matrix"|action: "reopen-review"|menuItems/);
  assert.match(page, /bothSigned && pendingReleaseOrders\.length > 0/);
  assert.match(page, /!site/);
});

test("master retry reports partial OPLOC completion and hides after all are ready", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const currentCount = final\.statuses\.filter\(status => status\.matrixStatus === "ready"\)\.length/);
  assert.match(page, /stillPending\.length/);
  assert.match(page, /retry still pending/);
  assert.match(page, /setFinalizationComplete\(statuses\.length === orderIds\.length && statuses\.every\(status => status\.matrixStatus === "ready"\)\)/);
});
