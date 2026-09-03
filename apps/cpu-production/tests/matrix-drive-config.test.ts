import assert from "node:assert/strict";
import test from "node:test";
import { matrixDriveConfiguration } from "../app/lib/matrix-drive-config";
import type { ProductionOrder } from "../lib/production-types";

const order = (origin: ProductionOrder["origin"], destinationOplocId?: string) => ({ origin, destinationOplocId } as ProductionOrder);
const originalEnv = { ...process.env };
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});

test("missing Drive configuration deliberately disables persistence", () => {
  delete process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON;
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
});

test("CPU Drive configuration enables the later finalisation path", () => {
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: true, ownerKey: "APP_CPU_PRODUCTION" });
});

test("CPU Drive configuration does not require an explicit folder override", () => {
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  delete process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID;
  assert.equal(matrixDriveConfiguration(order("menu_planning")).enabled, true);
});

test("Hospitality Drive configuration remains canonical-OPLOC scoped", () => {
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_ANGEL = "angel@fikacatering.com";
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_ANGEL = "configured-folder-later";
  assert.deepEqual(matrixDriveConfiguration(order("hospitality_booking", "oploc:angel")), { enabled: true, ownerKey: "OPLOC_ANGEL" });
});
