import type { ProductionOrder } from "../../lib/production-types";

export type MatrixDriveConfiguration =
  | { enabled: true; ownerKey: string }
  | { enabled: false; reason: "not_configured" };

function ownerKey(_order: ProductionOrder) { return "APP_CPU_PRODUCTION"; }

/** Server-only readiness gate. It never exposes configuration to browser code. */
export function matrixDriveConfiguration(order: ProductionOrder): MatrixDriveConfiguration {
  const key = ownerKey(order);
  // Hospitality orders are persisted by the Hospitality service, which resolves the governed site OPLOC owner and folder from the Hub
  // and fails closed (with a specific message) if either is missing. CPU holds no Drive credentials for them, so CPU's own
  // app-workspace owner/folder must not gate them; it only needs the Hospitality service to be configured.
  if (order.origin === "hospitality_booking") {
    return process.env.HOSPITALITY_BOOKING_BASE_URL?.trim() ? { enabled: true, ownerKey: `OPLOC_${key}` } : { enabled: false, reason: "not_configured" };
  }
  if (!key || !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) return { enabled: false, reason: "not_configured" };
  const ownerEmail = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
  // Production must target an explicitly governed folder. Staging/local retain
  // their existing default-folder behaviour until production destinations are
  // approved and configured.
  if (process.env.FIKA_RUNTIME_MODE === "production" && !process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID?.trim()) {
    return { enabled: false, reason: "not_configured" };
  }
  return ownerEmail ? { enabled: true, ownerKey: key } : { enabled: false, reason: "not_configured" };
}
