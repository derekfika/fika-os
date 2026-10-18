/**
 * Fail-closed destination check for server-side requests that carry a browser session cookie,
 * a FIKA internal token or a bridge token.
 *
 * - production: only the approved production origin(s) of the named service are accepted.
 * - staging: any origin except a production FIKA origin (staging must never forward to production).
 * - local: unchanged; loopback and developer URLs remain usable.
 *
 * Callers must also send credentialed requests with `redirect: "error"` so a compromised or
 * misconfigured upstream cannot bounce credentials to a second origin.
 */
export type CredentialedUpstreamService = "hub" | "menu" | "cpu" | "logistics" | "hospitality" | "delivered-in";

const PRODUCTION_ORIGINS: Record<CredentialedUpstreamService, readonly string[]> = {
  hub: ["https://fika-os-prod-hub--fika-os.europe-west4.hosted.app", "https://os.fikacatering.com"],
  menu: ["https://fika-os-prod-menu--fika-os.europe-west4.hosted.app", "https://menuplanner.fikacatering.com"],
  cpu: ["https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app", "https://cpu.fikacatering.com"],
  logistics: ["https://fika-os-prod-logistics--fika-os.europe-west4.hosted.app", "https://logistics.fikacatering.com"],
  hospitality: ["https://fika-os-prod-hospitality--fika-os.europe-west4.hosted.app", "https://hospitality.fikacatering.com"],
  "delivered-in": ["https://fika-os-prod-deliveredin--fika-os.europe-west4.hosted.app", "https://delivered-in.fikacatering.com"],
};

const ALL_PRODUCTION_ORIGINS = new Set(Object.values(PRODUCTION_ORIGINS).flat());

export class CredentialedUpstreamError extends Error {
  readonly status = 503;
  constructor(message: string, readonly code = "CREDENTIALED_UPSTREAM_REJECTED") { super(message); }
}

function parse(service: CredentialedUpstreamService, value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new CredentialedUpstreamError(`The ${service} upstream URL is invalid; credentials were not forwarded.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new CredentialedUpstreamError(`The ${service} upstream URL is not an approved HTTPS origin; credentials were not forwarded.`);
  }
  return url;
}

/** Returns the configured URL (without a trailing slash) when it is an approved destination for `service`. */
export function approvedCredentialedUpstream(
  service: CredentialedUpstreamService,
  configured: string,
  runtimeMode: string | undefined = process.env.FIKA_RUNTIME_MODE,
): string {
  const candidate = configured.trim().replace(/\/$/, "");
  if (runtimeMode === "production") {
    const url = parse(service, candidate);
    if (!PRODUCTION_ORIGINS[service].includes(url.origin)) {
      throw new CredentialedUpstreamError(`The ${service} upstream is not the approved production service; credentials were not forwarded.`);
    }
    return candidate;
  }
  if (runtimeMode === "staging") {
    const url = parse(service, candidate);
    if (ALL_PRODUCTION_ORIGINS.has(url.origin) || url.hostname.startsWith("fika-os-prod-")) {
      throw new CredentialedUpstreamError(`Staging ${service} upstream resolves to a production service; credentials were not forwarded.`);
    }
    return candidate;
  }
  return candidate;
}
