import { createPublicKey, createVerify } from "node:crypto";

export const STANDING_ORDER_SCHEDULER_AUDIENCE = "fika-delivered-in-standing-orders-scheduler";
export const HANDOFF_SCHEDULER_AUDIENCE = "fika-delivered-in-grab-and-go-handoff-recovery";
const CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const CLOCK_SKEW_SECONDS = 60;
const PROJECT_MODE: Record<string, "staging" | "production"> = {
  "fika-os-dev": "staging",
  "fika-os": "production",
};

type Certs = Record<string, string>;
let cached: { certs: Certs; expiresAt: number } | undefined;

export const schedulerServiceAccountFor = (projectId: string) =>
  `fika-deliveredin-gng-scheduler@${projectId}.iam.gserviceaccount.com`;

async function googleCerts(): Promise<Certs> {
  if (cached && cached.expiresAt > Date.now()) return cached.certs;
  const response = await fetch(CERTS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Google signing certificates are unavailable.");
  const certs = await response.json() as Certs;
  cached = { certs, expiresAt: Date.now() + 60 * 60 * 1000 };
  return certs;
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

/** Accept only a Google-signed ID token for this environment's one dedicated Scheduler identity and this route's audience. */
export async function schedulerRequestAllowed(
  request: { headers: { get(name: string): string | null } },
  runtime: { projectId: string; mode: string },
  audience: string,
  options: { certs?: () => Promise<Certs>; now?: () => number } = {},
): Promise<boolean> {
  try {
    const expectedMode = PROJECT_MODE[runtime.projectId];
    if (!expectedMode || runtime.mode !== expectedMode) return false;
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
      && claims.aud === audience
      && typeof claims.exp === "number" && claims.exp > seconds && claims.exp + CLOCK_SKEW_SECONDS > seconds
      && typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS <= seconds
      && (claims.nbf === undefined || (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS <= seconds))
      && claims.email_verified === true
      && claims.email === schedulerServiceAccountFor(runtime.projectId);
  } catch {
    return false;
  }
}
