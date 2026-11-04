import assert from "node:assert/strict";
import test from "node:test";
import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { containedMatrixReviewStatus, containedMatrixStatus, matrixDriveConfiguration } from "../app/lib/matrix-drive-config";
import type { ProductionOrder } from "../lib/production-types";

const order = (origin: ProductionOrder["origin"], destinationOplocId?: string) => ({ origin, destinationOplocId } as ProductionOrder);
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  globalThis.fetch = originalFetch;
});

async function primeSyntheticProductionIdentity() {
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.FIREBASE_PROJECT_ID = "fika-os";
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  const fetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    assert.equal(String(input), "http://metadata.google.internal/computeMetadata/v1/project/project-id");
    return new Response("fika-os", { headers: { "Metadata-Flavor": "Google" } });
  }) as typeof fetch;
  try {
    for (let attempt = 0; attempt < 20 && stagingDriveAccessBlocked(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(stagingDriveAccessBlocked(), false, "synthetic metadata establishes the production test identity");
  } finally {
    globalThis.fetch = fetch;
  }
}

test("missing Drive configuration deliberately disables persistence", () => {
  delete process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON;
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
});

test("staging holds CPU and Hospitality Drive materialisation regardless of configured folders", () => {
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID = "unverified-folder";
  process.env.HOSPITALITY_BOOKING_BASE_URL = "https://hospitality.example";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
  assert.deepEqual(matrixDriveConfiguration(order("hospitality_booking", "oploc:angel")), { enabled: false, reason: "not_configured" });
});

test("staging holds ready and generating artifacts while preserving failure diagnostics", async () => {
  process.env.FIKA_RUNTIME_MODE = "staging";
  assert.equal(containedMatrixStatus("ready"), "not_configured");
  assert.equal(containedMatrixStatus("generating"), "not_configured");
  assert.equal(containedMatrixStatus("failed"), "failed");
  assert.equal(containedMatrixStatus(undefined), undefined);
  assert.deepEqual(containedMatrixReviewStatus({ orderId: "fixture", matrixStatus: "failed", matrixArtifact: { driveUrl: "unverified" } }), { orderId: "fixture", matrixStatus: "failed" });
  await primeSyntheticProductionIdentity();
  assert.equal(containedMatrixStatus("ready"), "ready");
});

test("production CPU Drive stays disabled without an explicit folder even with DWD and owner", async () => {
  await primeSyntheticProductionIdentity();
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  delete process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID;
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
  process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID = "approved-production-folder";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: true, ownerKey: "APP_CPU_PRODUCTION" });
});

test("Hospitality orders are gated only on the Hospitality service, not on CPU app-workspace Drive settings", () => {
  process.env.FIKA_RUNTIME_MODE = "local";
  delete process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION;
  delete process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID;
  process.env.HOSPITALITY_BOOKING_BASE_URL = "https://hospitality.example";
  assert.deepEqual(matrixDriveConfiguration(order("hospitality_booking", "oploc:angel")), { enabled: true, ownerKey: "OPLOC_APP_CPU_PRODUCTION" });
  delete process.env.HOSPITALITY_BOOKING_BASE_URL;
  assert.deepEqual(matrixDriveConfiguration(order("hospitality_booking", "oploc:angel")), { enabled: false, reason: "not_configured" });
});

test("non-Hospitality (CPU default workspace) orders are still gated on the CPU owner, DWD and production folder", async () => {
  await primeSyntheticProductionIdentity();
  delete process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON;
  process.env.HOSPITALITY_BOOKING_BASE_URL = "https://hospitality.example";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
});
