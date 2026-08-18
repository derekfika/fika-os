import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import { execFile } from "node:child_process";

const clientFile = process.env.CPU_CALENDAR_OAUTH_CLIENT_FILE ?? "C:\\FIKA\\secrets\\calendar-oauth-client.json";
const tokenFile = process.env.CPU_CALENDAR_OAUTH_TOKEN_FILE ?? "C:\\FIKA\\secrets\\cpu-calendar-token.json";
const scope = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly";
type OAuthClient = { client_id: string; client_secret?: string; auth_uri: string; token_uri: string };
type ClientDocument = { installed?: OAuthClient; web?: OAuthClient };
function openBrowser(url: string) { if (process.platform === "win32") execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url]); else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url]); }

async function main() {
  if (!existsSync(clientFile)) throw new Error(`CPUX Calendar OAuth client not found: ${clientFile}`);
  const doc = JSON.parse(await readFile(clientFile, "utf8")) as ClientDocument;
  const client = doc.installed ?? doc.web;
  if (!client?.client_id || !client.auth_uri || !client.token_uri) throw new Error("Calendar OAuth client JSON is missing installed/web credentials.");
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Could not allocate OAuth callback port.");
  const redirectUri = `http://localhost:${address.port}/oauth2callback`;
  const authUrl = new URL(client.auth_uri); authUrl.searchParams.set("client_id", client.client_id); authUrl.searchParams.set("redirect_uri", redirectUri); authUrl.searchParams.set("response_type", "code"); authUrl.searchParams.set("access_type", "offline"); authUrl.searchParams.set("prompt", "consent"); authUrl.searchParams.set("login_hint", "cpux@fikacatering.com"); authUrl.searchParams.set("hd", "fikacatering.com"); authUrl.searchParams.set("scope", scope);
  console.log("Opening Google authorisation. Sign in as cpux@fikacatering.com and grant Calendar/Drive read-only access."); console.log(authUrl.toString()); openBrowser(authUrl.toString());
  const code = await new Promise<string>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Timed out waiting for Google authorisation.")), 5 * 60_000); server.on("request", (request, response) => { if (!request.url) return; const callback = new URL(request.url, redirectUri); if (callback.pathname !== "/oauth2callback") return; clearTimeout(timeout); const error = callback.searchParams.get("error"); if (error) { response.end("Authorisation failed."); reject(new Error(error)); return; } const value = callback.searchParams.get("code"); response.end("Authorisation complete. You can close this window."); value ? resolve(value) : reject(new Error("Google did not return an authorisation code.")); }); }); server.close();
  const response = await fetch(client.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!response.ok) throw new Error(`Google token exchange failed: ${await response.text()}`); const token = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
  await writeFile(tokenFile, `${JSON.stringify({ ...token, expiry_date: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined }, null, 2)}\n`); console.log(`CPUX Calendar authorisation saved to ${tokenFile}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
