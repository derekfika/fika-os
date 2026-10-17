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

test("staging CPU Drive configuration enables the existing finalisation path", () => {
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: true, ownerKey: "APP_CPU_PRODUCTION" });
});

test("production CPU Drive stays disabled without an explicit folder even with DWD and owner", () => {
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  delete process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID;
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: false, reason: "not_configured" });
  process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID = "approved-production-folder";
  assert.deepEqual(matrixDriveConfiguration(order("menu_planning")), { enabled: true, ownerKey: "APP_CPU_PRODUCTION" });
});

test("Hospitality matrix configuration retains its governed OPLOC owner diagnostic", () => {
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "configured-later";
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "derek@fikacatering.com";
  assert.deepEqual(matrixDriveConfiguration(order("hospitality_booking", "oploc:angel")), { enabled: true, ownerKey: "OPLOC_APP_CPU_PRODUCTION" });
});
