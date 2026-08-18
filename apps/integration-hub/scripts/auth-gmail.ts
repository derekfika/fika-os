import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import { execFile } from "node:child_process";

const clientFile = process.env.GMAIL_OAUTH_CLIENT_FILE ?? "C:\\FIKA\\secrets\\gmail-oauth-client.json";
const tokenFile = process.env.GMAIL_OAUTH_TOKEN_FILE ?? "C:\\FIKA\\secrets\\gmail-token.json";
const scope = "https://www.googleapis.com/auth/gmail.readonly";

type OAuthClient = {
  client_id: string;
  client_secret?: string;
  auth_uri: string;
  token_uri: string;
  redirect_uris?: string[];
};

type ClientDocument = { installed?: OAuthClient; web?: OAuthClient };

function openBrowser(url: string) {
  // Avoid `cmd /c start`: ampersands in OAuth query parameters are treated as
  // shell separators and can silently drop response_type/scope parameters.
  if (process.platform === "win32") execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  else if (process.platform === "darwin") execFile("open", [url]);
  else execFile("xdg-open", [url]);
}

async function main() {
  if (!existsSync(clientFile)) {
    throw new Error(`Gmail OAuth client file not found: ${clientFile}`);
  }

  const document = JSON.parse(await readFile(clientFile, "utf8")) as ClientDocument;
  const client = document.installed ?? document.web;
  if (!client?.client_id || !client.auth_uri || !client.token_uri) {
    throw new Error("The Gmail OAuth client JSON is missing installed/web client credentials.");
  }

  if (existsSync(tokenFile)) {
    try {
      const existing = JSON.parse(await readFile(tokenFile, "utf8")) as { refresh_token?: string };
      if (existing.refresh_token) {
        console.log(`A Gmail refresh token already exists at ${tokenFile}. Delete it only if you need to re-authorise.`);
        return;
      }
    } catch {
      // Empty placeholder files are expected on first authorisation.
    }
  }

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local OAuth callback port.");
  const redirectUri = `http://localhost:${address.port}/oauth2callback`;
  const authUrl = new URL(client.auth_uri);
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("login_hint", "seven@fikacatering.com");
  authUrl.searchParams.set("hd", "fikacatering.com");
  authUrl.searchParams.set("scope", scope);

  console.log("Opening Google authorisation. Sign in as seven@fikacatering.com and grant Gmail read-only access.");
  console.log(`If it does not open automatically, visit:\n${authUrl.toString()}`);
  openBrowser(authUrl.toString());

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Google authorisation.")), 5 * 60_000);
    server.on("request", (request, response) => {
      if (!request.url) return;
      const callback = new URL(request.url, redirectUri);
      if (callback.pathname !== "/oauth2callback") return;
      clearTimeout(timeout);
      const error = callback.searchParams.get("error");
      if (error) {
        response.end("Authorisation was cancelled. You can close this window.");
        reject(new Error(`Google authorisation failed: ${error}`));
        return;
      }
      const value = callback.searchParams.get("code");
      response.end("Authorisation complete. You can close this window and return to FIKA OS.");
      if (value) resolve(value);
      else reject(new Error("Google did not return an authorisation code."));
    });
  });
  server.close();

  const tokenResponse = await fetch(client.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed: ${await tokenResponse.text()}`);
  const token = (await tokenResponse.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
  await writeFile(tokenFile, `${JSON.stringify({ ...token, expiry_date: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined }, null, 2)}\n`, { encoding: "utf8" });
  console.log(`Gmail authorisation saved to ${tokenFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
