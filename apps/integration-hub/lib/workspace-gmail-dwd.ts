import { createPrivateKey } from "node:crypto";
import { JWT, type JWTOptions } from "google-auth-library";

const scope = "https://www.googleapis.com/auth/gmail.send";
type TokenClient = Pick<JWT, "getAccessToken">;
const client = (options: JWTOptions): TokenClient => new JWT(options);

/** Dedicated mailer credentials; no Drive fallback or Gmail API calls. */
export async function workspaceGmailToken(mailbox: string, env: Record<string, string | undefined> = process.env, makeClient = client) {
  if (!/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(mailbox)) throw new Error("Workspace Gmail mailbox is invalid.");
  let credentials: { type?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    credentials = JSON.parse(env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER || "");
    if (!credentials || credentials.type !== "service_account" || typeof credentials.client_email !== "string" || !credentials.client_email.endsWith(".gserviceaccount.com") || typeof credentials.private_key !== "string" || createPrivateKey(credentials.private_key).asymmetricKeyType !== "rsa") throw new Error();
  } catch { throw new Error("Workspace Gmail credentials are missing or malformed."); }
  try {
    const auth = makeClient({ email: credentials.client_email as string, key: credentials.private_key as string, subject: mailbox, scopes: [scope] });
    const token = await auth.getAccessToken();
    if (!token.token) throw new Error();
    return token.token;
  } catch { throw new Error("Workspace Gmail token request failed."); }
}

/** Explicit staging-only diagnostic. Returns booleans, never credentials or tokens. */
export async function verifyStagingGmailDwd(env: Record<string, string | undefined> = process.env, makeClient = client) {
  if (env.FIKA_RUNTIME_MODE !== "staging" || env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "false") throw new Error("Verification requires staging with email delivery disabled.");
  const result = { secretReadable: Boolean(env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER), dwdImpersonationSucceeded: false, mailbox: "mnk@fikacatering.com", tokenRequestSucceeded: false, emailsSent: 0 };
  try {
    await workspaceGmailToken(result.mailbox, env, makeClient);
    result.dwdImpersonationSucceeded = true;
    result.tokenRequestSucceeded = true;
  } catch { /* OAuth errors can contain credential-bearing request data. Never return or log them. */ }
  return result;
}
