import { createPublicKey, createVerify } from "node:crypto";

/**
 * Cloud Scheduler authenticates to the recovery route with a Google-signed OIDC identity token, so no shared secret is stored in
 * the scheduler job's metadata. The token must be signed by Google, unexpired, carry the fixed audience below, and belong to the
 * one verified scheduler service account for this project. Anything else is refused.
 */
export const SCHEDULER_AUDIENCE = "fika-logistics-driver-notifications-process";
const CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const CLOCK_SKEW_SECONDS = 60;

export const schedulerServiceAccountFor = (projectId: string) => `fika-logistics-notif-scheduler@${projectId}.iam.gserviceaccount.com`;

type Certs = Record<string, string>;
let cached: { certs: Certs; expiresAt: number } | undefined;

async function googleCerts(): Promise<Certs> {
  if (cached && cached.expiresAt > Date.now()) return cached.certs;
  const response = await fetch(CERTS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Google signing certificates are unavailable.");
  const certs = await response.json() as Certs;
  cached = { certs, expiresAt: Date.now() + 60 * 60 * 1000 };
  return certs;
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

/** True only for a valid Google ID token issued to this project's scheduler service account. Never throws. */
export async function schedulerRequestAllowed(
  request: { headers: { get(name: string): string | null } },
  projectId: string,
  options: { certs?: () => Promise<Certs>; now?: () => number } = {},
): Promise<boolean> {
  try {
    const bearer = request.headers.get("authorization");
    if (!bearer || !/^Bearer\s+\S+$/i.test(bearer)) return false;
    const [encodedHeader, encodedPayload, signature, ...rest] = bearer.replace(/^Bearer\s+/i, "").split(".");
    if (!encodedHeader || !encodedPayload || !signature || rest.length) return false;
    const header = decode(encodedHeader);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const certificate = (await (options.certs ?? googleCerts)())[header.kid];
    if (!certificate) return false;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    if (!verifier.verify(createPublicKey(certificate), Buffer.from(signature, "base64url"))) return false;
    const claims = decode(encodedPayload);
    const seconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
    return (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com")
      && claims.aud === SCHEDULER_AUDIENCE
      && typeof claims.exp === "number" && claims.exp + CLOCK_SKEW_SECONDS > seconds
      && typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS <= seconds
      && claims.email_verified === true
      && claims.email === schedulerServiceAccountFor(projectId);
  } catch {
    return false;
  }
}
