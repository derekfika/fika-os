import { GoogleAuth } from "google-auth-library";

const scope = "https://www.googleapis.com/auth/gmail.send";
const tokenAudience = "https://oauth2.googleapis.com/token";
const mailerServiceAccount = "fika-os-mailer@fika-os.iam.gserviceaccount.com";
const rcoaMailbox = "rcoa@fikacatering.com";
type JwtClaims = { iss: string; sub: string; scope: string; aud: string; iat: number; exp: number };
type SafeOAuthFailure = { code: string; description: string };
type Dependencies = {
  signJwt?: (serviceAccountEmail: string, claims: JwtClaims) => Promise<string>;
  exchangeJwt?: (assertion: string) => Promise<string>;
};

const knownOAuthErrorCodes = new Set([
  "invalid_request", "invalid_grant", "unauthorized_client", "unsupported_grant_type",
  "invalid_scope", "access_denied", "invalid_client", "server_error", "temporarily_unavailable",
]);

class WorkspaceOAuthExchangeError extends Error {
  constructor(readonly safeFailure: SafeOAuthFailure) {
    super("Workspace OAuth token exchange failed.");
  }
}

function safeOAuthFailure(body: unknown): SafeOAuthFailure {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const rawCode = typeof value.error === "string" ? value.error : "";
  const code = knownOAuthErrorCodes.has(rawCode) ? rawCode : "oauth_error";
  const rawDescription = typeof value.error_description === "string" ? value.error_description : "Google returned no OAuth error description.";
  const description = rawDescription
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted assertion]")
    .replace(/\b(access_token|refresh_token|assertion|client_secret|private_key|credential|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return { code, description: description || "Google returned no OAuth error description." };
}

async function signJwtWithIam(serviceAccountEmail: string, claims: JwtClaims) {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:signJwt`;
  const response = await client.request<{ signedJwt?: string }>({ url, method: "POST", data: { payload: JSON.stringify(claims) } });
  if (!response.data.signedJwt) throw new Error("IAM Credentials returned no signed JWT.");
  return response.data.signedJwt;
}

async function exchangeSignedJwt(assertion: string) {
  const response = await fetch(tokenAudience, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json().catch(() => ({})) as { access_token?: unknown; scope?: unknown; error?: unknown; error_description?: unknown };
  // OAuth permits omitting `scope` when the issued token has exactly the
  // requested scope. If Google returns a scope, fail closed on any mismatch.
  const scopeMismatch = result.scope !== undefined && result.scope !== scope;
  if (!response.ok) throw new WorkspaceOAuthExchangeError(safeOAuthFailure(result));
  if (typeof result.access_token !== "string" || !result.access_token || scopeMismatch) {
    throw new Error("Workspace OAuth token exchange failed.");
  }
  return result.access_token;
}

function signingClaims(mailbox: string, now = Math.floor(Date.now() / 1000)): JwtClaims {
  return { iss: mailerServiceAccount, sub: mailbox, scope, aud: tokenAudience, iat: now, exp: now + 3600 };
}

/** Dedicated keyless Gmail DWD. Never reads a service-account key or the Drive DWD credential. */
export async function workspaceGmailToken(mailbox: string, env: Record<string, string | undefined> = process.env, dependencies: Dependencies = {}) {
  if (mailbox !== rcoaMailbox) throw new Error("Workspace Gmail mailbox is not approved for RCoA verification.");
  if (env.FIKA_HOSPITALITY_EMAIL_MAILER_SERVICE_ACCOUNT?.trim() !== mailerServiceAccount) throw new Error("Workspace Gmail mailer service account is missing or invalid.");
  try {
    const assertion = await (dependencies.signJwt || signJwtWithIam)(mailerServiceAccount, signingClaims(mailbox));
    const token = await (dependencies.exchangeJwt || exchangeSignedJwt)(assertion);
    if (!token) throw new Error();
    return token;
  } catch (error) {
    // Provider errors may contain credential-bearing request data. Do not propagate or log them.
    if (error instanceof WorkspaceOAuthExchangeError) throw error;
    throw new Error("Workspace Gmail keyless token request failed.");
  }
}

/** Safe one-shot diagnostic. Allowed in staging or production only when delivery is explicitly disabled. */
export async function verifyGmailDwd(env: Record<string, string | undefined> = process.env, dependencies: Dependencies = {}) {
  const mode = env.FIKA_RUNTIME_MODE;
  if ((mode !== "staging" && mode !== "production") || env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "false") {
    throw new Error("Verification requires staging or production with email delivery explicitly disabled.");
  }
  if (mode === "production" && env.FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED !== "true") {
    throw new Error("Production DWD verification is not enabled.");
  }
  const mailbox = env.FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX?.trim() || "";
  const result = {
    credentialMode: "keyless" as const,
    credentialConfigured: env.FIKA_HOSPITALITY_EMAIL_MAILER_SERVICE_ACCOUNT?.trim() === mailerServiceAccount,
    dwdImpersonationSucceeded: false,
    mailbox,
    tokenRequestSucceeded: false,
    emailsSent: 0 as const,
  };
  if (mailbox !== rcoaMailbox || !result.credentialConfigured) return result;

  let signed = false;
  let exchanged = false;
  let oauthError: SafeOAuthFailure | undefined;
  try {
    await workspaceGmailToken(mailbox, env, {
      signJwt: async (serviceAccountEmail, claims) => {
        const assertion = await (dependencies.signJwt || signJwtWithIam)(serviceAccountEmail, claims);
        signed = true;
        return assertion;
      },
      exchangeJwt: async assertion => {
        const token = await (dependencies.exchangeJwt || exchangeSignedJwt)(assertion);
        exchanged = true;
        return token;
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceOAuthExchangeError) oauthError = error.safeFailure;
    // Return status plus sanitised OAuth diagnostics only; never expose provider payloads, assertions, or tokens.
  }
  result.dwdImpersonationSucceeded = signed;
  result.tokenRequestSucceeded = exchanged;
  return oauthError ? { ...result, oauthError } : result;
}
