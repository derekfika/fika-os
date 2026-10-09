import { createHash } from "node:crypto";
import { ensureGeneratedMenusFolder, menuDriveResourceId, publishMenuArtifact, resolveMenuTemplate, type MenuOutputFormat, type NormalizedMenu, type PublishedMenuArtifact } from "@fika/server-shared/menu-artifact";
import { driveAccessToken, driveFolderPath, resolveDriveOwner, type DriveOwner, type ResolvedDriveOwner } from "./drive-owner";

const json = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`Google API returned ${response.status} without JSON.`); }
  if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
};

async function googleFetch(input: string, init: RequestInit, label: string, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  catch (error) { if ((error as { name?: string }).name === "AbortError") throw new Error(`${label} timed out after 30 seconds.`); throw new Error(`${label} failed: ${(error as Error).message}`); }
  finally { clearTimeout(timer); }
}

async function driveHeaders(owner: DriveOwner) {
  const resolved = resolveDriveOwner(owner);
  const token = await driveAccessToken(resolved);
  return { owner: resolved, headers: { Authorization: `Bearer ${token}` } };
}

/** Accept either a Drive folder/file ID or a copied Drive URL. Users commonly
 * paste the whole `/folders/<id>` link (sometimes with trailing punctuation)
 * into .env.local; the Google APIs require only the stable ID. */
function driveResourceId(value?: string) { return menuDriveResourceId(value); }

async function assertDriveFolder(folderId: string, headers: Record<string, string>, operation: string) {
  const metadata = await json<{ id?: string; name?: string; mimeType?: string; trashed?: boolean }>(await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed`,
    { headers }, `${operation} folder validation`,
  ));
  if (metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed) {
    throw Error(`${operation} folder ${folderId} is not an accessible Google Drive folder.`);
  }
}

export function weekFolderName(weekCommencing?: string) { return weekCommencing ? `WC_${weekCommencing}` : undefined; }
async function resolveWeekFolder(rootFolderId: string, weekCommencing: string | undefined, headers: Record<string, string>, operation: string) {
  await assertDriveFolder(rootFolderId, headers, operation);
  const name = weekFolderName(weekCommencing);
  if (!name) return rootFolderId;
  const query = `'${rootFolderId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`, { headers }, `${operation} week folder lookup`));
  if (existing.files?.[0]?.id) return existing.files[0].id;
  const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [rootFolderId], mimeType: "application/vnd.google-apps.folder" }) }, `${operation} week folder creation`));
  return created.id;
}
async function resolveChildFolder(parentFolderId: string, folderName: string | undefined, headers: Record<string, string>, operation: string) {
  if (!folderName?.trim()) return parentFolderId;
  const name = folderName.trim().replace(/[\\/]+/g, "-").slice(0, 120);
  const query = `'${parentFolderId}' in parents and name = '${name.replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`, { headers }, `${operation} OPLOC folder lookup`));
  if (existing.files?.[0]?.id) return existing.files[0].id;
  const created = await json<{ id: string }>(await googleFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [parentFolderId], mimeType: "application/vnd.google-apps.folder" }) }, `${operation} OPLOC folder creation`));
  return created.id;
}

async function resolveArtifactFolder(owner: ResolvedDriveOwner, configuredFolderId: string | undefined, artifactType: "quote" | "menu" | "production", headers: Record<string, string>, operation: string) {
  const configured = driveResourceId(configuredFolderId || owner.configuredRootFolderId);
  if (configured) {
    await assertDriveFolder(configured, headers, operation);
    return configured;
  }
  let parent = "root";
  for (const folder of driveFolderPath(owner, artifactType)) parent = await resolveChildFolder(parent, folder, headers, operation);
  return parent;
}

/**
 * Generates the site menu from a normalized menu using the shared renderer and files it under
 * `Generated Menus/WC_<week commencing>` in the owner's Drive.
 * The site template is resolved by destination (never by workflow) and an
 * unconfigured or unknown site is an error, not a silently unbranded file.
 * Idempotent per exact revision and format: a retry reuses the existing Slides file.
 * The caller chooses the format (tablet menu, flat labels, tent labels).
 */
export async function createGoogleMenu(menu: NormalizedMenu, owner: DriveOwner, settings?: { folderId?: string; templateId?: string }, format: MenuOutputFormat = "tablet"): Promise<PublishedMenuArtifact> {
  const template = resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: menu.oplocId, templateIdOverride: settings?.templateId, format });
  const { owner: resolved, headers: authHeaders } = await driveHeaders(owner);
  const headers = { ...authHeaders, "content-type": "application/json" };
  // <configured folder, or the owner's My Drive>/Generated Menus/WC_<Monday of the service week>
  const configured = driveResourceId(settings?.folderId || resolved.configuredRootFolderId);
  if (configured) await assertDriveFolder(configured, headers, "Hospitality menu");
  const { folderId } = await ensureGeneratedMenusFolder({ parentId: configured || "root", serviceDate: menu.serviceDate, headers });
  return publishMenuArtifact({ menu, template, folderId, headers: authHeaders });
}

/** Save a generated quote beside the site's generated menu files. The file name
 * is supplied by the caller and is used as the idempotency key in that folder. */
export async function saveGoogleDriveHtml(input: { name: string; html: string; owner: DriveOwner; folderId?: string; weekCommencing?: string }) {
  const { owner, headers } = await driveHeaders(input.owner);
  const rootFolderId = await resolveArtifactFolder(owner, input.folderId, "quote", headers, "Quote");
  const folderId = await resolveWeekFolder(rootFolderId, input.weekCommencing, headers, "Quote");
  const escapedName = input.name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string; webViewLink?: string }> }>(await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink)&pageSize=1`,
    { headers }, "Google Drive quote lookup",
  ));
  const found = existing.files?.[0];
  if (found) return { fileId: found.id, driveUrl: found.webViewLink || `https://drive.google.com/open?id=${found.id}`, reused: true };

  const metadata = JSON.stringify({ name: input.name, parents: [folderId], mimeType: "text/html" });
  const boundary = `fika_quote_${Date.now()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${input.html}\r\n--${boundary}--\r\n`,
  ]);
  const uploaded = await json<{ id: string; webViewLink?: string }>(await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    { method: "POST", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body },
    "Google Drive quote upload",
  ));
  return { fileId: uploaded.id, driveUrl: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`, reused: false };
}

export async function saveGoogleDrivePdf(input: { name: string; pdfBase64: string; owner: DriveOwner; folderId?: string; weekCommencing?: string; folderLabel?: string; releaseId?: string }) {
  const { owner, headers } = await driveHeaders(input.owner);
  const rootFolderId = await resolveArtifactFolder(owner, input.folderId, "production", headers, input.folderLabel || "Allergen matrix");
  const weekFolderId = await resolveWeekFolder(rootFolderId, input.weekCommencing, headers, input.folderLabel || "Allergen matrix");
  const folderId = weekFolderId;
  const escapedName = input.name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
  const existing = await json<{ files?: Array<{ id: string; webViewLink?: string }> }>(await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,webViewLink)&pageSize=1`, { headers }, "Google Drive matrix lookup"));
  const found = existing.files?.[0];
  const boundary = `fika_matrix_${Date.now()}`;
  // Drive limits the combined appProperties key/value bytes to 124. CPU
  // release IDs intentionally carry full lineage and can exceed that limit;
  // retain a stable bounded fingerprint in Drive while CPU keeps the full ID.
  const releaseProperties = input.releaseId ? { fikaReleaseHash: createHash("sha256").update(input.releaseId).digest("hex") } : undefined;
  if (found) {
    // The lookup proves the existing file is already in the target folder.
    // Drive rejects `parents` in update metadata; moving would require the
    // separate addParents/removeParents query parameters and is unnecessary.
    const metadata = JSON.stringify({ name: input.name, mimeType: "application/pdf", ...(releaseProperties ? { appProperties: releaseProperties } : {}) });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`, `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${input.pdfBase64}\r\n--${boundary}--\r\n`]);
    await json(await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(found.id)}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: "PATCH", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body }, "Google Drive matrix update"));
    return { fileId: found.id, driveUrl: found.webViewLink || `https://drive.google.com/open?id=${found.id}`, reused: true };
  }
  const metadata = JSON.stringify({ name: input.name, parents: [folderId], mimeType: "application/pdf", ...(releaseProperties ? { appProperties: releaseProperties } : {}) });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`, `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${input.pdfBase64}\r\n--${boundary}--\r\n`]);
  const uploaded = await json<{ id: string; webViewLink?: string }>(await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", { method: "POST", headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` }, body }, "Google Drive matrix upload"));
  return { fileId: uploaded.id, driveUrl: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`, reused: false };
}
