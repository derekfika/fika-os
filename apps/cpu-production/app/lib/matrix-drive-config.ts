import type { ProductionOrder } from "../../lib/production-types";
import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";

export type MatrixDriveConfiguration =
  | { enabled: true; ownerKey: string }
  | { enabled: false; reason: "not_configured" };

function ownerKey(_order: ProductionOrder) { return "APP_CPU_PRODUCTION"; }

/** Keep historical evidence intact while not presenting a Drive artifact as usable during containment. */
export function containedMatrixStatus<T extends string | undefined>(status: T): T | "not_configured" {
  return stagingDriveAccessBlocked() && (status === "ready" || status === "generating") ? "not_configured" : status;
}

export function containedMatrixReviewStatus<T extends { matrixStatus?: string; matrixArtifact?: unknown }>(status: T) {
  if (!stagingDriveAccessBlocked()) return status;
  const { matrixArtifact: _artifact, ...rest } = status;
  return { ...rest, ...(status.matrixStatus ? { matrixStatus: containedMatrixStatus(status.matrixStatus) } : {}) };
}

/** Server-only readiness gate. It never exposes configuration to browser code. */
export function matrixDriveConfiguration(order: ProductionOrder): MatrixDriveConfiguration {
  if (stagingDriveAccessBlocked()) return { enabled: false, reason: "not_configured" };
  const key = ownerKey(order);
  // Hospitality orders are persisted by the Hospitality service, which resolves the governed site OPLOC owner and folder from the Hub
  // and fails closed (with a specific message) if either is missing. CPU holds no Drive credentials for them, so CPU's own
  // app-workspace owner/folder must not gate them; it only needs the Hospitality service to be configured.
  if (order.origin === "hospitality_booking") {
    return process.env.HOSPITALITY_BOOKING_BASE_URL?.trim() ? { enabled: true, ownerKey: `OPLOC_${key}` } : { enabled: false, reason: "not_configured" };
  }
  if (!key || !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) return { enabled: false, reason: "not_configured" };
  const ownerEmail = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
  // Production must target an explicitly governed folder. Local development
  // retains its existing default-folder behaviour.
  if (process.env.FIKA_RUNTIME_MODE === "production" && !process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID?.trim()) {
    return { enabled: false, reason: "not_configured" };
  }
  return ownerEmail ? { enabled: true, ownerKey: key } : { enabled: false, reason: "not_configured" };
}

// Response-only containment. Stored evidence and its status must remain unchanged.
export function containArtifactLinks<T>(value: T, blocked: boolean): T {
  if (!blocked) return value;
  const sensitive = new Set(["driveUrl", "driveFileId", "drivePdfUrl", "pdfDriveUrl", "pdfPath", "localUrl", "signedPdfUrl", "presentationUrl"]);
  function clean(input: unknown, artifact = false): unknown {
    if (Array.isArray(input)) return input.map(item => clean(item, artifact));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).flatMap(([key, item]) => {
      const context = artifact || /artifact|packet|bundle/i.test(key);
      if (sensitive.has(key) || (context && (key === "url" || key === "fileId"))) return [];
      if (typeof item === "string" && /https?:\/\/(drive|docs)\.google\.com\//i.test(item)) return [];
      return [[key, clean(item, context)]];
    }));
  }
  return clean(value) as T;
}
