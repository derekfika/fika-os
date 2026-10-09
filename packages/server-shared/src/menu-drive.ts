import { MenuArtifactError } from "./menu-types";

/**
 * Where generated menus are filed in Drive:
 *
 *   <parent>/Generated Menus/WC_<Monday of the service week>/<file>
 *
 * `WC_YYYY-MM-DD` is the week-commencing convention already used for quotes and
 * allergen matrices. Folders are found-or-created, so repeated generation never
 * makes duplicates; if two requests race and both create one, the oldest wins
 * on every later lookup.
 */

export const GENERATED_MENUS_FOLDER = "Generated Menus";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Monday (UK week start) of the week containing `date` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
export function menuWeekCommencing(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new MenuArtifactError("MENU_DATE_INVALID", "A menu needs a YYYY-MM-DD service date.");
  const day = new Date(`${date}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day.toISOString().slice(0, 10);
}

export function menuWeekFolderName(date: string) { return `WC_${menuWeekCommencing(date)}`; }

async function drive<T>(fetchImpl: FetchLike, url: string, init: RequestInit, label: string): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, init); }
  catch (error) { throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label} failed: ${(error as Error).message}`, 502); }
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label}: Google API returned ${response.status} without JSON.`, 502); }
  if (!response.ok) throw new MenuArtifactError("MENU_GOOGLE_UNAVAILABLE", `${label}: Google API ${response.status}: ${JSON.stringify(body).slice(0, 400)}`, 502);
  return body as T;
}

async function findOrCreateFolder(fetchImpl: FetchLike, headers: Record<string, string>, parentId: string, name: string) {
  const escaped = name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await drive<{ files?: Array<{ id: string }> }>(fetchImpl,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=createdTime&fields=files(id)&pageSize=1`,
    { headers }, `Google Drive "${name}" folder lookup`);
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await drive<{ id: string }>(fetchImpl, "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, parents: [parentId], mimeType: "application/vnd.google-apps.folder" }) },
    `Google Drive "${name}" folder creation`);
  return created.id;
}

/**
 * Resolves (creating as needed) `<parent>/Generated Menus/WC_<week commencing>` for a
 * service date and returns the week folder's id. `parentId` is a Drive folder id or `root`.
 */
export async function ensureGeneratedMenusFolder(input: { parentId: string; serviceDate: string; headers: Record<string, string>; fetch?: FetchLike }) {
  const fetchImpl: FetchLike = input.fetch || ((url, init) => fetch(url, init));
  const generated = await findOrCreateFolder(fetchImpl, input.headers, input.parentId, GENERATED_MENUS_FOLDER);
  return { folderId: await findOrCreateFolder(fetchImpl, input.headers, generated, menuWeekFolderName(input.serviceDate)), generatedMenusFolderId: generated, weekFolderName: menuWeekFolderName(input.serviceDate) };
}
