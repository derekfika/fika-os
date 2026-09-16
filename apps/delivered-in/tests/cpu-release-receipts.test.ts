import assert from "node:assert/strict";
import test from "node:test";
import { beginCpuReleaseReceipt, completeCpuReleaseReceipt, failCpuReleaseReceipt, resetCpuReleaseReceiptsForTests, type CpuReleaseEventIdentity } from "../lib/cpu-release-receipts";

const event = (overrides: Partial<CpuReleaseEventIdentity> = {}): CpuReleaseEventIdentity => ({
  deliveryId: "delivery:release-2:oploc-a", eventId: "release-event:2:published", eventType: "published", releaseId: "release:2", releaseVersion: "v2", oplocId: "oploc:a", serviceDate: "2026-09-16", sourceDayId: "day:2", sourcePublicationDayId: "publication-day:2", sourceVersion: 2, sourceContentHash: "menu-hash-2", packetContentHash: "packet-hash-2", ...overrides,
});

test("CPU release receipt makes response-loss replay a duplicate without reapplying", async () => {
  resetCpuReleaseReceiptsForTests();
  const first = await beginCpuReleaseReceipt(event());
  assert.equal(first.status, "claimed");
  const applied = await completeCpuReleaseReceipt(event(), { result: "applied", projectionId: "delivered-in:oploc:a:2026-09-16", projectionContentHash: "projection-hash", artifactId: "artifact:2", driveFileId: "drive:2" });
  assert.equal(applied.result, "applied");
  const replay = await beginCpuReleaseReceipt(event());
  assert.equal(replay.status, "duplicate");
  assert.equal(replay.receipt.driveFileId, "drive:2");
});

test("receipt claim is single-winner and older releases are superseded", async () => {
  resetCpuReleaseReceiptsForTests();
  const [first, second] = await Promise.all([beginCpuReleaseReceipt(event()), beginCpuReleaseReceipt(event({ eventId: "release-event:2:published:retry" }))]);
  assert.deepEqual([first.status, second.status].sort(), ["claimed", "processing"]);
  await completeCpuReleaseReceipt(event(), { result: "applied" });
  const older = await beginCpuReleaseReceipt(event({ deliveryId: "delivery:release-1:oploc-a", eventId: "release-event:1:published", releaseId: "release:1", releaseVersion: "v1", sourceDayId: "day:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 1, sourceContentHash: "menu-hash-1", packetContentHash: "packet-hash-1" }));
  assert.equal(older.status, "superseded");
});

test("release receipts remain isolated by OPLOC", async () => {
  resetCpuReleaseReceiptsForTests();
  const siteA = event(); const siteB = event({ deliveryId: "delivery:release-2:oploc-b", eventId: "release-event:2:published:b", oplocId: "oploc:b" });
  assert.equal((await beginCpuReleaseReceipt(siteA)).status, "claimed");
  assert.equal((await beginCpuReleaseReceipt(siteB)).status, "claimed");
});

test("failed delivery claims remain retryable instead of wedging replay", async () => {
  resetCpuReleaseReceiptsForTests();
  assert.equal((await beginCpuReleaseReceipt(event())).status, "claimed");
  await failCpuReleaseReceipt(event(), Object.assign(new Error("Drive unavailable"), { code: "DRIVE_UNAVAILABLE" }));
  const retry = await beginCpuReleaseReceipt(event());
  assert.equal(retry.status, "claimed");
  const applied = await completeCpuReleaseReceipt(event(), { result: "applied", driveFileId: "drive:retry" });
  assert.equal(applied.result, "applied");
  assert.equal((await beginCpuReleaseReceipt(event())).status, "duplicate");
});
