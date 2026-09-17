import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captureSigningLineage, signingLineageUnavailableMessage, type MatrixLineage } from "../app/allergens/signing-lineage";

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

test("lineage failure identifies the affected OPLOC name and stable ID", () => {
  const message = signingLineageUnavailableMessage(["order:commerzbank", "order:xchange"], { "order:commerzbank": "Commerzbank", "order:xchange": "FIKA Xchange" }, ["order:xchange"]);
  assert.match(message, /FIKA Xchange \(order:xchange\)/);
  assert.doesNotMatch(message, /Commerzbank/);
  assert.match(message, /Reload the review/);
  assert.throws(
    () => captureSigningLineage(["order:commerzbank", "order:xchange"], "2026-09-14", [{ orderId: "order:commerzbank", sourceLineage: lineage("order:commerzbank", "b".repeat(64)) }], { "order:commerzbank": "Commerzbank", "order:xchange": "FIKA Xchange" }),
    /FIKA Xchange \(order:xchange\)/,
  );
});

test("opening the signature modal does not wait for review persistence", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const begin = page.indexOf("const beginSigning = (");
  const openModal = page.indexOf("setSigning({ role })", begin);
  const batchSign = page.indexOf('action: "sign-master-matrix"');
  const beginBlock = page.slice(begin, openModal);
  assert.ok(begin >= 0 && openModal > begin && batchSign >= 0);
  assert.doesNotMatch(beginBlock, /await saveReviewRef|batch-plan|matrixStatus=1/);
  assert.doesNotMatch(beginBlock, /async/);
  assert.match(page, /onRegisterReviewState/);
  assert.match(page, /signingSnapshotRef/);
  assert.match(page, /reviewOperations/);
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
  assert.match(matrix, /saveTimer/);
  assert.match(matrix, /setTimeout\(/);
  assert.match(matrix, /if \(inFlightSave\.current\) \{[\s\S]*await inFlightSave\.current/);
  assert.match(matrix, /if \(!locked\) return/);
  assert.match(matrix, /editVersionRef\.current \+= 1/);
});

test("post-sign hydration keeps the committed role locked and semantic no-op saves cannot revoke authority", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /const \[hydrating, setHydrating\] = useState\(false\)/);
  assert.match(page, /locked=\{hydrating \|\| reviewFrozen \|\| bothSigned \|\| Boolean\(signing\)\}/);
  assert.match(matrix, /onHydrationChange\?\.\(true\)/);
  assert.match(matrix, /onHydrationChange\?\.\(false\)/);
  assert.match(route, /const noOpSave = Boolean\(storedPlan && operation\.action === "save-plan" && !contentChanged && plan\.planningNotes === operation\.planningNotes && authorityMatches && plan\.status === effectiveNextStatus\)/);
  assert.doesNotMatch(route, /if \(contentChanged \|\| plan\.currentAllergenRelease\) invalidateSignedAllergenAuthority/);
});

test("review session saves only once when dirty, never resaves between signatures, and supports explicit amendment", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const toggle = matrix.slice(matrix.indexOf("  const toggle ="), matrix.indexOf("\n\n  return (", matrix.indexOf("  const toggle =")));
  assert.equal(toggle.includes("fetch("), false);
  assert.match(toggle, /startSave/);
  assert.match(matrix, /dirtyRef\.current = true/);
  assert.equal((matrix.match(/action: \"batch-plan\"/g) || []).length, 1);
  assert.equal((matrix.match(/await submit\(action\)/g) || []).length, 1);
  assert.match(matrix, /await startSave\(latestStatesRef\.current, \"mark-planned\"\)/);
  assert.match(page, /setReviewFrozen\(true\)/);
  assert.match(page, /const refreshReviewStatus = async/);
  assert.match(page, /await refreshReviewStatus\(\)/);
  assert.doesNotMatch(page, /load\(date, \{ resetSession: false \}\)/);
  assert.match(page, /const signingSnapshot = signingSnapshotRef\.current/);
  assert.match(page, /const reopenForAmendment = async/);
  assert.match(page, /action: "reopen-review"/);
  assert.match(route, /action: z\.literal\("reopen-review"\)/);
  assert.match(route, /allergen-review-reopened/);
  assert.match(route, /invalidateSignedAllergenAuthorityForNewSourceLineage\(plan, auditActor, timestamp, "The allergen review was explicitly reopened for amendment\."\)/);
  assert.match(route, /CPU_REVIEW_REOPEN_REQUIRED/);
});

test("live clean-but-unreviewed state requires one authoritative completion, while exact reviewed state is a no-op", async () => {
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(matrix, /reviewed: boolean/);
  assert.match(matrix, /const authoritativeReviewed = allStatusesPresent && statuses\.every\(status => status\.reviewed\)/);
  assert.match(matrix, /authoritativeReviewedRef\.current = authoritativeReviewed/);
  assert.match(matrix, /evidenceStatus: action === "mark-planned" \? "completed"/);
  assert.match(matrix, /body: JSON\.stringify\(\{ action: "batch-plan", operations: orders\.map/);
});

test("signing uses one attempt-scoped master command and confirms every member", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /signingAttemptRef/);
  assert.match(page, /crypto\.randomUUID\(\)/);
  assert.match(page, /action: "sign-master-matrix"/);
  assert.match(page, /orderIds: masterOrders\.map/);
  assert.match(page, /expectedLineages: masterOrders\.map/);
  assert.match(page, /commandId: \["cpu-master-sign", signingAttempt\.id, role\]\.join\(":"\)/);
  assert.doesNotMatch(page.slice(page.indexOf("const sign = async"), page.indexOf("const reopenForAmendment")), /for \(const order of targets\)/);
  assert.match(page, /roleAuthoritativelyPresent/);
  assert.match(page, /authoritative matrix status did not confirm/);
  assert.match(route, /CPU_SIGN_IDEMPOTENCY_CONFLICT/);
  assert.match(route, /MasterSignCommand/);
  assert.match(route, /CPU_MASTER_SIGN_MEMBERSHIP_CONFLICT/);
  assert.match(route, /idempotencyKey: `\$\{command\.commandId\}:\$\{item\.order\.canonicalId\}`/);
  assert.match(route, /hasExactSignature\(plan, command\.role, currentScope\)/);
  assert.match(route, /!event\.duplicate/);
});

test("master signing commits the latest reviewed matrix with its signature", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /const reviewOperations = signingReviewRef\.current\?\.\(\)/);
  assert.match(page, /reviewOperations,/);
  assert.match(route, /reviewedPlan = await mergeOriginalItems/);
  assert.match(route, /candidate\.planningNotes = reviewOperation\.planningNotes/);
  assert.match(route, /plan-marked-planned/);
  assert.match(route, /signingStatus: "committed"/);
  assert.match(route, /role: command\.role/);
  assert.match(route, /fullySigned/);
  assert.match(route, /postCommitStatus: "queued"/);
});

test("master signing queues durable post-commit work after the authoritative commit", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const master = route.slice(route.indexOf("async function applyMasterSignatureBatch"), route.indexOf("async function applyMatrixOperation"));
  assert.match(master, /route: "\/api\/internal\/cpu-post-commit"/);
  assert.match(master, /deliveries: \[postCommitDelivery/);
  assert.match(master, /after\(async \(\) =>/);
  assert.doesNotMatch(master, /await rebuildCpuDayProjection|await rebuildCpuWeekProjection|await rebuildCpuReviewPackage|await deliverCpuPropagation\(materialization/);
  assert.match(master, /postCommitStatus: "queued"/);
  assert.match(master, /materializationOnCriticalPath: false/);
});

test("post-commit worker is bounded, retryable, and reports safe timing metrics", async () => {
  const worker = await readFile(new URL("../lib/cpu-post-commit-worker.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/internal/cpu-post-commit/route.ts", import.meta.url), "utf8");
  assert.match(worker, /job\.orderIds\.includes/);
  assert.match(worker, /latestCpuChangeSequence/);
  assert.match(worker, /buildCpuPropagationEvents/);
  assert.match(worker, /CPU_POST_COMMIT_CONCURRENCY = 4/);
  assert.match(worker, /mapWithConcurrency\(oplocIds, CPU_POST_COMMIT_CONCURRENCY/);
  assert.match(worker, /materializationStartMs/);
  assert.match(worker, /housekeepingMs/);
  assert.match(worker, /console\.info\("FIKA CPU post-commit worker completed"/);
  assert.match(route, /internalTokenAllowed/);
  assert.match(route, /processCpuPostCommitJob/);
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
  assert.match(retryBlock, /action: "retry-materialization"/);
  assert.match(retryBlock, /expectedLineage/);
  assert.match(retryBlock, /const final = await refreshReviewStatus\(\)/);
  assert.doesNotMatch(retryBlock, /action: "sign-matrix"|action: "reopen-review"|menuItems/);
  assert.match(page, /bothSigned && retryEligible && pendingReleaseOrders\.length > 0/);
  assert.match(page, /mapWithConcurrency\(retryOrders, MAX_PARALLEL_RETRIES/);
  assert.match(page, /!site/);
});

test("master retry reports partial OPLOC completion and hides after all are ready", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const currentCount = final\.statuses\.filter\(status => status\.matrixStatus === "ready"\)\.length/);
  assert.match(page, /stillPending\.length/);
  assert.match(page, /retry still pending/);
  assert.match(page, /setFinalizationComplete\(statuses\.length === orderIds\.length && statuses\.every\(status => status\.matrixStatus === "ready"\)\)/);
});

test("release polling stops at terminal statuses and cleans up on date changes", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const poll = page.slice(page.indexOf("const pollReleaseStatus"), page.indexOf("const pendingReleaseOrders"));
  assert.match(poll, /setTimeout\(\(\) => void refresh\(\)\.catch\(\(\) => undefined\), 2500\)/);
  assert.match(poll, /\["ready", "failed", "not_configured"\]/);
  assert.match(page, /releasePollTimerRef\.current\) clearTimeout/);
  assert.match(page, /releasePollRunRef\.current \+= 1/);
});

test("master signing distinguishes generating from failed materialization and lets authoritative status win", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const review = await readFile(new URL("../lib/delivered-in-review.ts", import.meta.url), "utf8");
  assert.match(page, /MATERIALIZATION_GRACE_MS = 15_000/);
  assert.match(page, /Fully signed · generating OPLOC releases/);
  assert.match(page, /setSignatureMessage\(`\$\{currentCount\} OPLOC release/);
  assert.match(page, /setRetryEligible\(eligible\)/);
  assert.match(page, /status\.matrixStatus === "failed"/);
  assert.match(review, /materializationStatus === "failed"/);
  assert.match(review, /matrixStatus: "failed"/);
  assert.doesNotMatch(page, /current\. .*Materialisation delivery failed/);
});

test("signing awaits the serialized matrix save barrier and finalization uses one master artifact", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../lib/cpu-post-commit-worker.ts", import.meta.url), "utf8");
  const materializer = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  const masterReview = await readFile(new URL("../lib/cpu-master-review.ts", import.meta.url), "utf8");
  const outboxWorker = await readFile(new URL("../scripts/cpu-durable-outbox-worker.ts", import.meta.url), "utf8");
  const signBlock = page.slice(page.indexOf("const sign = async"), page.indexOf("const reopenForAmendment"));
  assert.match(signBlock, /await saveReviewRef\.current\?\.\(\)/);
  assert.match(page, /onRegisterSave=\{save => \{ saveReviewRef\.current = save; \}\}/);
  assert.match(worker, /createCpuMasterArtifact/);
  assert.match(worker, /allergen-master-artifact-shared/);
  assert.match(worker, /saveCpuMasterReview/);
  assert.match(masterReview, /fikaCpuMasterAllergenReviewsV1/);
  assert.doesNotMatch(masterReview, /signatureDataUrl/);
  assert.match(materializer, /CPU_RELEASE_RECONCILIATION_DELAY_MS = 60_000/);
  assert.match(materializer, /route: "\/api\/delivered-in\/reconcile"/);
  assert.match(outboxWorker, /recoverCpuPropagation/);
});

test("post-commit starts release materialisation before derived housekeeping", async () => {
  const worker = await readFile(new URL("../lib/cpu-post-commit-worker.ts", import.meta.url), "utf8");
  const materialization = worker.indexOf("const materializationWork =");
  const housekeeping = worker.indexOf("const projectionWork =");
  assert.ok(materialization >= 0 && housekeeping > materialization);
  assert.match(worker, /const materializationResults = await materializationWork/);
  assert.match(worker, /mapWithConcurrency\(materializationIds, CPU_POST_COMMIT_CONCURRENCY/);
});
