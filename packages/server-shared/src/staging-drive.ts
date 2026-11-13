/** Hosted staging uses an ordinary user OAuth grant, never domain-wide delegation. */
export const APPROVED_STAGING_DRIVE_ROOT = "1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z";
const scope = "https://www.googleapis.com/auth/drive";
const id = /^[A-Za-z0-9_-]{1,200}$/;
export function stagingDriveSettings(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.FIKA_RUNTIME_MODE !== "staging" || env.FIKA_STAGING_DRIVE_ENABLED !== "true") throw Error("Staging Drive is disabled.");
  const projects = [env.FIREBASE_PROJECT_ID, env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT].filter(Boolean);
  if (env.FIREBASE_CONFIG) projects.push(JSON.parse(env.FIREBASE_CONFIG).projectId);
  if (!projects.length || projects.some(project => project !== "fika-os-dev")) throw Error("Staging Drive requires consistent development project claims.");
  if (env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON || env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER) throw Error("Remove DWD credentials before enabling staging Drive.");
  const email = env.FIKA_STAGING_DRIVE_EMAIL?.trim().toLowerCase();
  const permissionId = env.FIKA_STAGING_DRIVE_PERMISSION_ID?.trim();
  const root = env.FIKA_STAGING_DRIVE_ROOT_ID?.trim();
  const allowed = env.FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS?.split(",").map(value => value.trim()).filter(Boolean);
  if (!email || !permissionId || !id.test(permissionId) || root !== APPROVED_STAGING_DRIVE_ROOT || allowed?.length !== 2 || new Set(allowed).size !== 2 || !allowed.includes(permissionId)) throw Error("Staging Drive identity, ACL and approved root must be explicit.");
  const sentinels = env.FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS?.split(",").map(value => value.trim()).filter(Boolean);
  if (!sentinels?.length || sentinels.length > 10 || sentinels.some(value => !id.test(value) || value === root)) throw Error("Production denial sentinels must be explicit and bounded.");
  return { email, permissionId, root, allowed, sentinels };
}
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw Error(`Staging Drive verification failed (${response.status}).`);
  return response.json() as Promise<T>;
}
export async function stagingDriveSession(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch) {
  const settings = stagingDriveSettings(env);
  const options = { redirect: "error" as const, signal: AbortSignal.timeout(5000), cache: "no-store" as const };
  const metadata = await fetcher("http://metadata.google.internal/computeMetadata/v1/project/project-id", { ...options, headers: { "Metadata-Flavor": "Google" } });
  if (!metadata.ok || metadata.headers.get("Metadata-Flavor") !== "Google" || (await metadata.text()).trim() !== "fika-os-dev") throw Error("Staging Drive requires verified development runtime identity.");
  // Parse credentials only after independent runtime verification. Never accept service-account keys.
  let credential: Record<string, string>;
  try { credential = JSON.parse(env.FIKA_STAGING_DRIVE_OAUTH_JSON || "{}"); } catch { throw Error("Invalid staging OAuth configuration."); }
  if (credential.type || credential.private_key || credential.client_email || !credential.client_id || !credential.client_secret || !credential.refresh_token) throw Error("A staging user OAuth grant is required.");
  const token = await json<{ access_token?: string; token_type?: string; scope?: string }>(await fetcher("https://oauth2.googleapis.com/token", { ...options, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: credential.client_id, client_secret: credential.client_secret, refresh_token: credential.refresh_token, grant_type: "refresh_token" }) }));
  if (!token.access_token || token.token_type?.toLowerCase() !== "bearer" || token.scope?.trim() !== scope) throw Error("Unexpected staging OAuth token scope or type.");
  const headers = { authorization: `Bearer ${token.access_token}` };
  const about = await json<{ user?: { emailAddress?: string; permissionId?: string } }>(await fetcher("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)", { ...options, headers }));
  if (about.user?.emailAddress?.toLowerCase() !== settings.email || about.user?.permissionId !== settings.permissionId) throw Error("The OAuth grant belongs to a different Drive user.");
  const folder = await json<{ id?: string; mimeType?: string; trashed?: boolean; driveId?: string; capabilities?: { canAddChildren?: boolean }; permissions?: Array<{ id?: string; type?: string; role?: string; deleted?: boolean }> }>(await fetcher(`https://www.googleapis.com/drive/v3/files/${settings.root}?fields=id,mimeType,trashed,driveId,capabilities(canAddChildren),permissions(id,type,role,deleted)`, { ...options, headers }));
  if (folder.id !== settings.root || folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed || folder.driveId || !folder.capabilities?.canAddChildren || !folder.permissions?.length || folder.permissions.some(permission => permission.deleted || permission.type !== "user" || !permission.id || !settings.allowed.includes(permission.id)) || !settings.allowed.every(allowed => folder.permissions!.some(permission => permission.id === allowed)) || !folder.permissions.some(permission => permission.id !== settings.permissionId && permission.role === "owner") || !folder.permissions.some(permission => permission.id === settings.permissionId && permission.role === "writer")) throw Error("The staging root ACL or capability is not approved.");
  for (const sentinel of settings.sentinels) {
    const denied = await fetcher(`https://www.googleapis.com/drive/v3/files/${sentinel}?fields=id`, { ...options, headers });
    if (denied.status === 403) {
      const error = await denied.json() as { error?: { errors?: Array<{ reason?: string }> } };
      if (!error.error?.errors?.some(item => item.reason === "insufficientFilePermissions" || item.reason === "forbidden")) throw Error("Production denial probe was inconclusive.");
    } else if (denied.status !== 404) {
      await denied.body?.cancel();
      throw Error("The staging principal did not prove denial of production file access.");
    } else await denied.body?.cancel();
  }
  return { ...settings, token: token.access_token };
}
/** Reject stored IDs and configured overrides outside the root, including shortcuts and cycles. */
export async function assertStagingDriveResource(fileId: string, authorization: string, fetcher: typeof fetch = fetch) {
  if (process.env.FIKA_RUNTIME_MODE !== "staging") return;
  const { root } = stagingDriveSettings();
  const seen = new Set<string>();
  let current = fileId;
  for (let depth = 0; depth < 32; depth++) {
    if (!id.test(current) || seen.has(current)) break;
    if (current === root) return;
    seen.add(current);
    const file = await json<{ id?: string; parents?: string[]; mimeType?: string; trashed?: boolean }>(await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(current)}?fields=id,parents,mimeType,trashed`, { headers: { authorization }, redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" }));
    if (file.id !== current || file.trashed || file.mimeType === "application/vnd.google-apps.shortcut" || file.parents?.length !== 1) break;
    current = file.parents[0];
  }
  throw Error("Drive resource is outside the approved staging root.");
}
