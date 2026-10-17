import type { HospitalityMatrixStorageContext } from "@fika/server-shared/hospitality-matrix-storage";
import { menuDriveResourceId } from "@fika/server-shared/menu-artifact";
import { driveOwnerEnvKey, resolveDriveOwner, type DriveOwner } from "./drive-owner";

/** Folder precedence: dashboard override, governed OPLOC root, existing CPU default.
 * An explicit site destination can never fall back to another owner's workspace. */
export function resolveMatrixDriveStorage(context: HospitalityMatrixStorageContext) {
  if (!context || !["hospitality-site", "cpu-default"].includes(context.kind)) throw new Error("Hub matrix storage context is invalid.");
  if (context.kind === "hospitality-site") {
    if (!context.oplocId?.startsWith("oploc:")) throw new Error("Matrix storage requires a canonical site OPLOC.");
    const owner: DriveOwner = { type: "oploc-workspace", oplocId: context.oplocId };
    const key = driveOwnerEnvKey(owner);
    const folderId = context.googleMatrixFolderId?.trim() || process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_${key}`]?.trim();
    if (folderId) {
      const resourceId = menuDriveResourceId(folderId);
      if (!resourceId || !/^[A-Za-z0-9_-]+$/.test(resourceId) || /REPLACE_ME|placeholder/i.test(resourceId)) {
        throw new Error(`Matrix Drive folder is invalid for ${context.oplocId}; no fallback was attempted.`);
      }
      // Require a governed owner even locally: explicit site storage must never
      // silently select the local/shared OAuth identity.
      const email = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /REPLACE_ME|placeholder/i.test(email)) {
        throw new Error(`Matrix Drive owner is not configured for ${context.oplocId} with an explicit site folder.`);
      }
      const resolved = resolveDriveOwner(owner);
      if (resolved.authMode !== "dwd") throw new Error("Site matrix storage requires the governed Drive owner's DWD authentication.");
      return { owner, folderId: resourceId, folderLabel: "CPU production" };
    }
  }
  const cpuOwner: DriveOwner = { type: "app-workspace", appId: "cpu-production" };
  const cpuFolderId = process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID?.trim();
  if (process.env.FIKA_RUNTIME_MODE === "production") {
    const resourceId = cpuFolderId ? menuDriveResourceId(cpuFolderId) : undefined;
    if (!resourceId || !/^[A-Za-z0-9_-]+$/.test(resourceId) || /REPLACE_ME|placeholder/i.test(resourceId)) {
      throw new Error("Production CPU matrix storage requires an explicitly configured CPU Drive folder; no fallback was attempted.");
    }
    const ownerEmail = process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION?.trim();
    if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) {
      throw new Error("Production CPU matrix storage requires its governed DWD owner; no fallback was attempted.");
    }
    const resolved = resolveDriveOwner(cpuOwner);
    if (resolved.authMode !== "dwd") throw new Error("Production CPU matrix storage requires the governed DWD owner's authentication.");
    return { owner: cpuOwner, folderId: resourceId, folderLabel: "CPU production" };
  }
  return { owner: cpuOwner, folderId: cpuFolderId, folderLabel: "CPU production" };
}
