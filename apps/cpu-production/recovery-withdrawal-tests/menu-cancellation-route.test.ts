import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";

const port = 8208;
const host = `127.0.0.1:${port}`;
const saved = { nodeEnv: process.env.NODE_ENV, mode: process.env.FIKA_RUNTIME_MODE, emulator: process.env.FIRESTORE_EMULATOR_HOST, project: process.env.FIREBASE_PROJECT_ID, snapshots: process.env.FIKA_SNAPSHOT_DIR, token: process.env.FIKA_INTERNAL_API_TOKEN, fetch: globalThis.fetch };
let emulator: ChildProcess | undefined;
let directory = "";
const listening = () => new Promise<boolean>(resolve => {
  const socket = net.connect(port, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

before(async () => {
  assert.equal(await listening(), false, `port ${port} must be free for the isolated Firestore emulator`);
  directory = mkdtempSync(path.join(tmpdir(), "fika-cpu-withdrawal-"));
  writeFileSync(path.join(directory, "firebase.json"), JSON.stringify({ emulators: { firestore: { host: "127.0.0.1", port }, ui: { enabled: false } } }));
  emulator = spawn("firebase", ["emulators:start", "--only", "firestore", "--project", "demo-fika-os"], { cwd: directory, shell: true, detached: process.platform !== "win32", stdio: "ignore" });
  const deadline = Date.now() + 90_000;
  while (!(await listening())) {
    assert.ok(Date.now() < deadline, "the isolated Firestore emulator did not start");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIRESTORE_EMULATOR_HOST = host;
  process.env.FIREBASE_PROJECT_ID = "demo-fika-os";
  process.env.FIKA_SNAPSHOT_DIR = path.join(directory, "snapshots");
  process.env.FIKA_INTERNAL_API_TOKEN = "withdrawal-test-token";
  Reflect.deleteProperty(process.env, "NODE_ENV");
}, { timeout: 120_000 });

after(() => {
  globalThis.fetch = saved.fetch;
  for (const [key, value] of [["NODE_ENV", saved.nodeEnv], ["FIKA_RUNTIME_MODE", saved.mode], ["FIRESTORE_EMULATOR_HOST", saved.emulator], ["FIREBASE_PROJECT_ID", saved.project], ["FIKA_SNAPSHOT_DIR", saved.snapshots], ["FIKA_INTERNAL_API_TOKEN", saved.token]] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, key); else Reflect.set(process.env, key, value);
  }
  if (emulator?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(emulator.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-emulator.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("Menu cancellation revokes current CPU release and stages one Delivered-In withdrawal atomically on replay", { timeout: 120_000 }, async () => {
  const serviceDate = "2026-11-05";
  const orderId = "production-order:menu-withdrawal-test";
  const releaseId = "cpu-allergen-release:menu-withdrawal-test:v1";
  const order = {
    canonicalId: orderId, entityType: "Production Order", schemaVersion: "0.1.0", version: 2, requirementIds: [], sourceBookingId: "", sourceQuoteRevisionId: "", origin: "menu_planning", status: "cancelled", serviceDate,
    requiredBy: `${serviceDate}T12:00:00.000Z`, serviceWindow: { startTime: "12:00" }, destinationOplocId: "oploc:withdrawal-test", destinationLabel: "Test site", priority: "normal", lines: [], exceptions: [], audit: [], currentRevision: 2,
  };
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order }), { status: 200 });
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [order] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { db } = await import("../lib/firebase-admin");
  const planRef = db.collection("fikaCpuProductionPlansV1").doc(orderId);
  const release = {
    releaseId, serviceDate, status: "current", materializationStatus: "ready", sourceVersion: 1, sourceContentHash: "b".repeat(64), version: 1, matrixContentHash: "c".repeat(64), signedAt: "2026-11-04T12:00:00.000Z",
    signatures: [{ role: "production_chef", valid: true }, { role: "head_chef_site_manager", valid: true }], masterArtifact: { contentHash: "d".repeat(64) }, derivedArtifacts: [], packetArtifacts: [{ contentHash: "a".repeat(64) }], matrix: [], deltaFromPrevious: [],
  };
  await planRef.set({ id: `production-plan:${orderId}`, orderId, status: "planned", menuItems: [], audit: [], updatedAt: "2026-11-04T12:00:00.000Z", updatedBy: "reviewer", signatures: release.signatures, signedSignatures: release.signatures, signedMenuContentHash: "e".repeat(64), currentAllergenRelease: release });
  const { POST } = await import("../app/api/production/route");
  const request = () => new NextRequest("http://localhost/api/production", { method: "POST", headers: { "content-type": "application/json", "x-fika-internal-token": "withdrawal-test-token" }, body: JSON.stringify({ action: "sync-production-event", serviceDate, entityId: orderId, revision: 2, changeType: "cancelled", changedAt: "2026-11-04T14:00:00.000Z", idempotencyKey: "menu-cancellation-test-v2" }) });
  const first = await POST(request());
  assert.equal(first.status, 200, await first.clone().text());
  const stored = (await planRef.get()).data()!;
  assert.equal(stored.currentAllergenRelease, undefined);
  assert.equal(stored.signatures, undefined);
  assert.equal(stored.signedSignatures, undefined);
  assert.equal(stored.matrixArtifact, undefined);
  assert.equal(stored.audit.filter((event: { action: string }) => event.action === "allergen-release-revoked").length, 1);
  assert.equal(stored.allergenReleaseHistory.length, 1);
  assert.equal(stored.allergenReleaseHistory[0].status, "revoked");
  assert.ok(stored.allergenReleaseHistory[0].signatures.every((signature: { valid: boolean }) => !signature.valid));
  const outbox = await db.collection("fikaCpuPropagationOutboxV1").get();
  assert.equal(outbox.docs.filter(doc => doc.data().payload?.body?.eventType === "revoked" && doc.data().payload?.body?.releaseId === releaseId).length, 1);
  const changesBeforeReplay = (await db.collection("fikaCpuProductionChangesV1").get()).size;
  const second = await POST(request());
  assert.equal(second.status, 200, await second.clone().text());
  const replayed = (await planRef.get()).data()!;
  assert.deepEqual(replayed.audit, stored.audit);
  assert.deepEqual(replayed.allergenReleaseHistory, stored.allergenReleaseHistory);
  assert.equal((await db.collection("fikaCpuProductionChangesV1").get()).size, changesBeforeReplay);
  assert.equal((await db.collection("fikaCpuPropagationOutboxV1").get()).docs.filter(doc => doc.data().payload?.body?.eventType === "revoked" && doc.data().payload?.body?.releaseId === releaseId).length, 1);
  const { GET } = await import("../app/api/delivered-in/review/route");
  const reviewUrl = `http://localhost/api/delivered-in/review?serviceDate=${serviceDate}&oplocId=oploc%3Awithdrawal-test`;
  const review = await GET(new NextRequest(reviewUrl));
  assert.ok(review);
  assert.equal(review.status, 200);
  assert.equal((await review.json()).status, "pending");
  const pdf = await GET(new NextRequest(`${reviewUrl}&download=pdf`));
  assert.ok(pdf);
  assert.equal(pdf.status, 409, "a withdrawn source must not expose the former signed PDF");
});
