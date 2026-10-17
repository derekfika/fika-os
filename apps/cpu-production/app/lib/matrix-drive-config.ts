import type { ProductionOrder } from "../../lib/production-types";

export type MatrixDriveConfiguration =
  | { enabled: true; ownerKey: string }
  | { enabled: false; reason: "not_configured" };

function ownerKey(_order: ProductionOrder) { return "APP_CPU_PRODUCTION"; }

/** Server-only readiness gate. It never exposes configuration to browser code. */
export function matrixDriveConfiguration(order: ProductionOrder): MatrixDriveConfiguration {
  const key = ownerKey(order);
  if (!key || !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) return { enabled: false, reason: "not_configured" };
  const ownerEmail = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
  // Production must target an explicitly governed folder. Staging/local retain
  // their existing default-folder behaviour until production destinations are
  // approved and configured.
  if (process.env.FIKA_RUNTIME_MODE === "production" && !process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID?.trim()) {
    return { enabled: false, reason: "not_configured" };
  }
  return ownerEmail ? { enabled: true, ownerKey: order.origin === "hospitality_booking" ? `OPLOC_${key}` : key } : { enabled: false, reason: "not_configured" };
}
