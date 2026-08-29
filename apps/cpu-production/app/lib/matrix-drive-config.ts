import type { ProductionOrder } from "../../lib/production-types";

export type MatrixDriveConfiguration =
  | { enabled: true; ownerKey: string }
  | { enabled: false; reason: "not_configured" };

function ownerKey(order: ProductionOrder) {
  if (order.origin === "hospitality_booking") {
    return order.destinationOplocId?.replace(/^oploc:/, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  }
  return "APP_CPU_PRODUCTION";
}

/** Server-only readiness gate. It never exposes configuration to browser code. */
export function matrixDriveConfiguration(order: ProductionOrder): MatrixDriveConfiguration {
  const key = ownerKey(order);
  if (!key || !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) return { enabled: false, reason: "not_configured" };
  const ownerEmail = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${order.origin === "hospitality_booking" ? `OPLOC_${key}` : key}`]?.trim();
  const folderId = order.origin === "hospitality_booking"
    ? process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_${key}`]?.trim()
    : process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID?.trim();
  return ownerEmail && folderId ? { enabled: true, ownerKey: order.origin === "hospitality_booking" ? `OPLOC_${key}` : key } : { enabled: false, reason: "not_configured" };
}
