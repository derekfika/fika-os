import { driveOwnerEnvKey, type DriveOwner } from '@fika/server-shared/drive-owner';
import { MenuArtifactError } from '@fika/server-shared/menu-artifact';

/** An explicit OPLOC destination must never inherit another site's identity or root. */
export function siteMenuDriveConfig(oplocId: string) {
  const owner: DriveOwner = { type: 'oploc-workspace', oplocId };
  const key = driveOwnerEnvKey(owner);
  const email = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
  const root = process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_${key}`]?.trim();
  if (email || root) {
    if (!email || !root || !/^[A-Za-z0-9_-]+$/.test(root)) throw new MenuArtifactError('MENU_SITE_DRIVE_NOT_CONFIGURED', 'The selected site needs both its approved Drive owner and menu output folder configured.', 409);
    return { owner, folderId: root };
  }
  const folderId = process.env.GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN;
  if (!folderId) throw new MenuArtifactError('MENU_OUTPUT_FOLDER_NOT_CONFIGURED', 'The Delivered-In menu output folder is not configured.', 409);
  return { owner: { type: 'app-workspace', appId: 'delivered-in' } as DriveOwner, folderId };
}
