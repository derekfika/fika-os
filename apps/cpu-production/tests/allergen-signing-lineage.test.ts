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

test("debounced review writes are cancelled/flushed and serialized before signing", async () => {
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(matrix, /pendingSave/);
  assert.match(matrix, /startSave/);
  assert.match(matrix, /clearTimeout\(syncTimer\.current\)/);
  assert.match(matrix, /if \(pending\) \{[\s\S]*await startSave\(pending\.states\)/);
  assert.match(matrix, /if \(inFlightSave\.current\) \{[\s\S]*await inFlightSave\.current/);
});

test("post-sign hydration keeps the committed role locked and semantic no-op saves cannot revoke authority", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /const \[hydrating, setHydrating\] = useState\(false\)/);
  assert.match(page, /locked=\{hydrating \|\| bothSigned \|\| Boolean\(signing\)\}/);
  assert.match(matrix, /onHydrationChange\?\.\(true\)/);
  assert.match(matrix, /onHydrationChange\?\.\(false\)/);
  assert.match(route, /const noOpSave = Boolean\(storedPlan && operation\.action === "save-plan" && !contentChanged && plan\.planningNotes === operation\.planningNotes && authorityMatches\)/);
  assert.doesNotMatch(route, /if \(contentChanged \|\| plan\.currentAllergenRelease\) invalidateSignedAllergenAuthority/);
});
