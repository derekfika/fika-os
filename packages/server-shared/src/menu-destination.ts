import { driveAccessToken, driveOwnerEnvKey, resolveDriveOwner, type ResolvedDriveOwner } from "./drive-owner";
import { canonicalOplocId } from "./governed-oplocs";
import { menuDriveResourceId } from "./menu-drive";
import { MenuArtifactError } from "./menu-types";

/**
 * OPLOC-scoped Drive destination for generated menus.
 *
 * Every site (OPLOC) names its own Workspace Drive owner and its own menu parent folder, both
 * explicit configuration keyed by the canonical OPLOC id:
 *
 *   GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<KEY>         the Workspace user DWD impersonates when publishing (hosted)
 *   GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_<KEY>     the folder that holds <parent>/Generated Menus/WC_<Monday>/...
 *   (GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<KEY>     the OPLOC's existing Drive root, accepted when no menu parent is set)
 *
 * `<KEY>` is the OPLOC id without the `oploc:` prefix, upper-cased with non-alphanumerics as `_`
 * (see `menuParentEnvKey`). Nothing is guessed: there is no app-wide owner or folder fallback, no
 * My Drive root fallback and no auto-created parent path. A missing or malformed value is an
 * actionable error naming the exact key. Only the `Generated Menus/WC_...` structure beneath an
 * explicit, verified parent is created.
 */

export type MenuDestination = {
  oplocId: string;
  /** The Workspace identity DWD impersonates (hosted) or the local OAuth user (local development). */
  owner: ResolvedDriveOwner;
  parentFolderId: string;
  parentSource: "site-setting" | "oploc-menu-parent" | "oploc-drive-root";
};

const OPLOC_ID = /^oploc:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function menuOwnerEnvKey(oplocId: string) { return `GOOGLE_DRIVE_OWNER_EMAIL_${driveOwnerEnvKey({ type: "oploc-workspace", oplocId })}`; }
export function menuParentEnvKey(oplocId: string) { return `GOOGLE_MENU_PARENT_FOLDER_ID_${driveOwnerEnvKey({ type: "oploc-workspace", oplocId })}`; }
const rootEnvKey = (oplocId: string) => `GOOGLE_DRIVE_ROOT_FOLDER_ID_${driveOwnerEnvKey({ type: "oploc-workspace", oplocId })}`;

/**
 * Resolves the owner and menu parent folder for one OPLOC from explicit configuration.
 * `parentFolderIdOverride` is a site-scoped dashboard setting (Hospitality's per-site menu folder).
 */
export function resolveMenuDestination(input: { oplocId?: string; parentFolderIdOverride?: string }): MenuDestination {
  const oplocId = canonicalOplocId(input.oplocId?.trim());
  if (!oplocId || !OPLOC_ID.test(oplocId)) throw new MenuArtifactError("MENU_DESTINATION_OPLOC_REQUIRED", "Generated menus are filed per site: a canonical OPLOC id (oploc:<uuid>) is required to resolve the Drive owner and menu folder.", 409);
  const ownerKey = menuOwnerEnvKey(oplocId);
  let owner: ResolvedDriveOwner;
  try { owner = resolveDriveOwner({ type: "oploc-workspace", oplocId }); }
  catch (error) { throw new MenuArtifactError("MENU_DRIVE_OWNER_NOT_CONFIGURED", `No Drive owner is configured for ${oplocId}. Set ${ownerKey} to that site's Workspace owner email (${(error as Error).message}).`, 409); }
  if (owner.workspaceEmail !== undefined && !EMAIL.test(owner.workspaceEmail)) throw new MenuArtifactError("MENU_DRIVE_OWNER_INVALID", `${ownerKey} must be an email address.`, 409);
  const parentKey = menuParentEnvKey(oplocId);
  const candidates: Array<{ value: string | undefined; source: MenuDestination["parentSource"] }> = [
    { value: input.parentFolderIdOverride, source: "site-setting" },
    { value: process.env[parentKey], source: "oploc-menu-parent" },
    { value: process.env[rootEnvKey(oplocId)], source: "oploc-drive-root" },
  ];
  const chosen = candidates.map(candidate => ({ ...candidate, id: menuDriveResourceId(candidate.value) })).find(candidate => candidate.id);
  if (!chosen?.id) throw new MenuArtifactError("MENU_PARENT_FOLDER_NOT_CONFIGURED", `No menu parent folder is configured for ${oplocId}. Set ${parentKey} to the Drive folder ID that should hold that site's "Generated Menus" folder.`, 409);
  return { oplocId, owner, parentFolderId: chosen.id, parentSource: chosen.source };
}

/** Access token for the destination's owner: DWD impersonates exactly `owner.workspaceEmail` (hosted); local OAuth locally. */
export function menuDestinationToken(destination: MenuDestination) { return driveAccessToken(destination.owner); }
