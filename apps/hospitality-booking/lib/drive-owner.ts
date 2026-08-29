import crypto from "node:crypto";
import { promises as fs } from "node:fs";

export type DriveOwner =
  | { type: "oploc-workspace"; oplocId: string }
  | { type: "app-workspace"; appId: "cpu-production" | "delivered-in" };

export type ResolvedDriveOwner = DriveOwner & {
  workspaceEmail?: string;
  configuredRootFolderId?: string;
  authMode: "dwd" | "local-oauth";
};

function hostedMode() {
  return process.env.FIKA_RUNTIME_MODE !== "local" && process.env.NODE_ENV === "production";
}

function ownerKey(owner: DriveOwner) {
  const value = owner.type === "oploc-workspace" ? owner.oplocId : owner.appId;
  return value.replace(/^oploc:/, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

export function driveOwnerEnvKey(owner: DriveOwner) {
  return owner.type === "oploc-workspace"
    ? `OPLOC_${ownerKey(owner)}`
    : `APP_${ownerKey(owner)}`;
}

export function driveOwnerLabel(owner: DriveOwner) {
  return owner.type === "oploc-workspace" ? owner.oplocId : owner.appId;
}

export function resolveDriveOwner(owner: DriveOwner): ResolvedDriveOwner {
  const key = driveOwnerEnvKey(owner);
  const workspaceEmail = process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`]?.trim();
  const configuredRootFolderId = process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_${key}`]?.trim()
    || (!hostedMode() ? process.env.GOOGLE_MENU_OUTPUT_FOLDER_ID?.trim() : undefined);
  if (hostedMode() && !workspaceEmail) throw new Error(`Google Drive owner is not configured for ${driveOwnerLabel(owner)}.`);
  if (hostedMode() && !process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON?.trim()) throw new Error("Google Workspace Domain-Wide Delegation is not configured for Drive.");
  return {
    ...owner,
    ...(workspaceEmail ? { workspaceEmail } : {}),
    ...(configuredRootFolderId ? { configuredRootFolderId } : {}),
    authMode: hostedMode() ? "dwd" : "local-oauth",
  };
}

export function driveFolderPath(owner: DriveOwner, artifactType: "quote" | "menu" | "production") {
  return ["FIKA OS", owner.type === "oploc-workspace" ? "Hospitality" : "CPU Production", artifactType === "quote" ? "Quotes" : artifactType === "menu" ? "Menus" : "Production"];
}

type OAuthClient = { installed?: { client_id: string; client_secret: string; token_uri?: string } };
type OAuthToken = { access_token?: string; refresh_token?: string; expiry_date?: number; token_type?: string };

async function localOAuthAccessToken() {
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_FILE;
  const clientPath = process.env.GOOGLE_OAUTH_CLIENT_FILE;
  if (!tokenPath || !clientPath) throw new Error("Local Google OAuth client and token files are not configured.");
  const [client, token] = await Promise.all([
    fs.readFile(clientPath, "utf8").then(value => JSON.parse(value) as OAuthClient),
    fs.readFile(tokenPath, "utf8").then(value => JSON.parse(value) as OAuthToken),
  ]);
  const installed = client.installed;
  if (!installed?.client_id || !installed.client_secret || !token.refresh_token) throw new Error("Local Google OAuth token is missing a refresh token.");
  if (token.access_token && (!token.expiry_date || token.expiry_date > Date.now() + 60_000)) return token.access_token;
  const response = await fetch(installed.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: installed.client_id, client_secret: installed.client_secret, refresh_token: token.refresh_token, grant_type: "refresh_token" }),
  });
  const body = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Local Google OAuth refresh failed: ${body.error || response.status}.`);
  await fs.writeFile(tokenPath, JSON.stringify({ ...token, ...body, expiry_date: Date.now() + (body.expires_in || 3600) * 1000 }, null, 2), "utf8");
  return body.access_token;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

async function dwdAccessToken(owner: ResolvedDriveOwner) {
  if (!owner.workspaceEmail) throw new Error(`Google Drive owner is not configured for ${driveOwnerLabel(owner)}.`);
  let credentials: { client_email?: string; private_key?: string };
  try { credentials = JSON.parse(process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON || "") as typeof credentials; }
  catch { throw new Error("Google Workspace Domain-Wide Delegation credentials are invalid."); }
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Workspace Domain-Wide Delegation credentials are incomplete.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600, sub: owner.workspaceEmail }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(signature)}` }),
  });
  const body = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google Workspace Drive authentication failed: ${body.error || response.status}.`);
  return body.access_token;
}

export async function driveAccessToken(owner: ResolvedDriveOwner) {
  return owner.authMode === "dwd" ? dwdAccessToken(owner) : localOAuthAccessToken();
}
