import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = await fs.readFile(path.join(appRoot, ".env.local"), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const clientPath = env.GOOGLE_OAUTH_CLIENT_FILE || path.resolve(appRoot, "../../secrets/google-oath-client.json");
const tokenPath = env.GOOGLE_OAUTH_TOKEN_FILE || path.resolve(appRoot, "../../secrets/google-token.json");
const clientJson = JSON.parse(await fs.readFile(clientPath, "utf8"));
const client = clientJson.installed || clientJson.web;
if (!client?.client_id || !client.client_secret) throw new Error("The Google OAuth client JSON is missing client_id or client_secret.");

let redirectUri = "";
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (!url.searchParams.has("code")) { response.writeHead(404); response.end("Waiting for Google OAuth callback."); return; }
  try {
    const tokenResponse = await fetch(client.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    const body = await tokenResponse.json();
    if (!tokenResponse.ok || !body.refresh_token) throw new Error(body.error_description || body.error || "Google did not return a refresh token.");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify({ ...body, expiry_date: Date.now() + (body.expires_in || 3600) * 1000 }, null, 2), { encoding: "utf8", mode: 0o600 });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end("<h1>FIKA menu authorisation complete</h1><p>You can close this window and return to the terminal.</p>");
    setTimeout(() => server.close(() => process.exit(0)), 100);
  } catch (error) { response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); response.end(`Authorisation failed: ${error.message}`); setTimeout(() => server.close(() => process.exit(1)), 100); }
});
const port = await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)).once("error", reject));
redirectUri = `http://localhost:${port}/oauth2callback`;
const authUrl = new URL(client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/presentations" }).toString();
console.log("Opening Google consent in your browser…"); console.log(`If it does not open, visit:\n${authUrl}\n`);
// Do not use `cmd /c start` here: ampersands in the query string are parsed as
// shell separators and Google then receives a truncated URL (often missing
// response_type). The Windows URL handler preserves the complete query.
execFile("rundll32.exe", ["url.dll,FileProtocolHandler", authUrl.toString()]); console.log("Waiting for authorisation callback…");
